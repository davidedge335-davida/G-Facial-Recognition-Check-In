import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  Camera,
  CameraOff,
  RefreshCw,
  FlipHorizontal,
  AlertTriangle,
  ShieldCheck,
  Sparkles,
  UserCheck,
  Upload
} from 'lucide-react';
import { captureAndCompressFrame, checkFacePresence } from '../utils/faceMatcher';

interface CameraViewProps {
  onCaptureFrame: (frameBase64: string, imageData: ImageData) => void;
  isProcessing: boolean;
  statusText: string;
  hasError: boolean;
}

export const CameraView: React.FC<CameraViewProps> = ({
  onCaptureFrame,
  isProcessing,
  statusText,
  hasError
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const isMountedRef = useRef<boolean>(true);
  const requestIdRef = useRef<number>(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [cameraState, setCameraState] = useState<'requesting' | 'active' | 'denied' | 'unsupported'>('requesting');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isFlashActive, setIsFlashActive] = useState<boolean>(false);
  const [isAutoDetect, setIsAutoDetect] = useState<boolean>(true);
  const autoDetectTimerRef = useRef<number | null>(null);

  // 彻底停止并释放媒体流轨道
  const stopCurrentStream = useCallback(() => {
    if (streamRef.current) {
      try {
        streamRef.current.getTracks().forEach(track => {
          try {
            track.stop();
          } catch (e) {
            // ignore
          }
        });
      } catch (e) {
        // ignore
      }
      streamRef.current = null;
    }

    if (videoRef.current && videoRef.current.srcObject) {
      try {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => {
          try {
            track.stop();
          } catch (e) {
            // ignore
          }
        });
      } catch (e) {
        // ignore
      }
      videoRef.current.srcObject = null;
    }
  }, []);

  // 启动摄像头（带并发拦截、设备释放冷却与占线自愈重试）
  const startCamera = useCallback(async () => {
    const currentRequestId = ++requestIdRef.current;
    setCameraState('requesting');
    setErrorMessage('');

    // 首先停止当前可能持有的流
    stopCurrentStream();

    // 留出 150ms 冷却时间让操作系统与驱动完全释放硬件句柄
    await new Promise(resolve => setTimeout(resolve, 150));
    if (!isMountedRef.current || requestIdRef.current !== currentRequestId) {
      return;
    }

    // 严谨检测环境是否支持 WebRTC 与媒体设备接口
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraState('unsupported');
      if (typeof window !== 'undefined' && !window.isSecureContext && window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
        setErrorMessage('当前页面未在安全上下文 (HTTPS) 中运行，浏览器禁用了摄像头权限。请使用 HTTPS 访问，或通过下方按钮上传自拍照打卡。');
      } else {
        setErrorMessage('当前浏览器环境不支持直接调起摄像头。您仍可通过下方按钮选择自拍照打卡。');
      }
      return;
    }

    // 增加 12 秒安全超时，防止某些 WebView 挂起或不响应权限弹窗导致页面无限卡在“正在调起”
    const getUserMediaWithTimeout = (constraints: MediaStreamConstraints, timeoutMs = 12000): Promise<MediaStream> => {
      let timer: number;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => {
          reject(new Error('CAMERA_TIMEOUT'));
        }, timeoutMs);
      });
      return Promise.race([
        navigator.mediaDevices.getUserMedia(constraints),
        timeoutPromise
      ]).finally(() => {
        clearTimeout(timer);
      });
    };

    try {
      let stream: MediaStream;

      try {
        // 首选参数：指定前后置及建议分辨率 640x480
        const preferredConstraints: MediaStreamConstraints = {
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 640 },
            height: { ideal: 480 }
          },
          audio: false
        };
        stream = await getUserMediaWithTimeout(preferredConstraints);
      } catch (initialErr: any) {
        if (initialErr.message === 'CAMERA_TIMEOUT') {
          throw initialErr;
        }

        // 捕获 Device in use 或 NotReadableError 并执行延迟降级自愈
        const errMsg = String(initialErr.message || '').toLowerCase();
        const errName = String(initialErr.name || '');
        const isDeviceInUse =
          errName === 'NotReadableError' ||
          errName === 'TrackStartError' ||
          errMsg.includes('in use') ||
          errMsg.includes('device');

        if (isDeviceInUse && isMountedRef.current && requestIdRef.current === currentRequestId) {
          // 暂停 350ms，强制再次释放后降级尝试宽泛 video 约束
          stopCurrentStream();
          await new Promise(resolve => setTimeout(resolve, 350));
          if (!isMountedRef.current || requestIdRef.current !== currentRequestId) return;

          stream = await getUserMediaWithTimeout({
            video: true,
            audio: false
          });
        } else {
          throw initialErr;
        }
      }

      // 如果当前请求已过时，立即释放新流
      if (!isMountedRef.current || requestIdRef.current !== currentRequestId) {
        stream.getTracks().forEach(t => {
          try {
            t.stop();
          } catch (e) {
            // ignore
          }
        });
        return;
      }

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        const activateVideo = () => {
          if (videoRef.current && isMountedRef.current && requestIdRef.current === currentRequestId) {
            videoRef.current.play().catch(e => console.warn('自动播放受阻:', e));
            setCameraState('active');
          }
        };

        videoRef.current.onloadedmetadata = activateVideo;
        videoRef.current.onloadeddata = activateVideo;

        // 如果元数据已就绪或延迟未触发，设置多重兜底保护
        if (videoRef.current.readyState >= 2) {
          activateVideo();
        } else {
          setTimeout(() => {
            if (isMountedRef.current && requestIdRef.current === currentRequestId && stream.active) {
              activateVideo();
            }
          }, 1200);
        }
      }
    } catch (err: any) {
      if (!isMountedRef.current || requestIdRef.current !== currentRequestId) return;
      console.warn('摄像头调用状态:', err.message || err.name);
      setCameraState('denied');

      const errMsg = String(err.message || '').toLowerCase();
      const errName = String(err.name || '');

      if (err.message === 'CAMERA_TIMEOUT') {
        setErrorMessage('调用摄像头超时，可能权限提示未弹出或被拦截，请尝试点击“重试”或直接上传照片打卡。');
      } else if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
        setErrorMessage('摄像头权限被拒绝，请在手机浏览器设置中允许本站访问摄像头，或使用下方按钮上传照片打卡。');
      } else if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
        setErrorMessage('未检测到可用的摄像头硬件设备，您可使用相册自拍照打卡。');
      } else if (errName === 'NotReadableError' || errName === 'TrackStartError' || errMsg.includes('in use')) {
        setErrorMessage('摄像头已被其他软件或网页占用 (Device in use)。可尝试关闭占用软件或点击“释放并重连”。');
      } else {
        setErrorMessage(`摄像头启动受阻: ${err.message || '请确认摄像头未被占用'}`);
      }
    }
  }, [facingMode, stopCurrentStream]);

  // 本地照片上传打卡降级方案（即使摄像头不可用也能顺畅打卡）
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      if (!dataUrl) return;

      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 480;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // 居中按比例绘制到 640x480
        ctx.fillStyle = '#1a1917';
        ctx.fillRect(0, 0, 640, 480);

        const scale = Math.min(640 / img.width, 480 / img.height);
        const x = (640 - img.width * scale) / 2;
        const y = (480 - img.height * scale) / 2;
        ctx.drawImage(img, x, y, img.width * scale, img.height * scale);

        const compressedBase64 = canvas.toDataURL('image/jpeg', 0.85);
        const imgData = ctx.getImageData(0, 0, 640, 480);

        setIsFlashActive(true);
        setTimeout(() => setIsFlashActive(false), 200);
        onCaptureFrame(compressedBase64, imgData);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  useEffect(() => {
    isMountedRef.current = true;
    startCamera();

    return () => {
      isMountedRef.current = false;
      stopCurrentStream();
      if (autoDetectTimerRef.current) {
        clearInterval(autoDetectTimerRef.current);
        autoDetectTimerRef.current = null;
      }
    };
  }, [startCamera, stopCurrentStream]);

  // 手动截帧打卡
  const handleManualCapture = () => {
    if (!videoRef.current || cameraState !== 'active' || isProcessing) return;

    // 触发拍照闪光反馈
    setIsFlashActive(true);
    setTimeout(() => setIsFlashActive(false), 200);

    const result = captureAndCompressFrame(videoRef.current);
    if (result) {
      onCaptureFrame(result.base64, result.imageData);
    }
  };

  // 翻转摄像头（前置/后置）
  const toggleFacingMode = () => {
    setFacingMode(prev => (prev === 'user' ? 'environment' : 'user'));
  };

  // 自动检测轮询（每 1.2 秒检测画面是否有面部变化并尝试比对）
  useEffect(() => {
    if (!isAutoDetect || cameraState !== 'active' || isProcessing) {
      if (autoDetectTimerRef.current) {
        clearInterval(autoDetectTimerRef.current);
        autoDetectTimerRef.current = null;
      }
      return;
    }

    autoDetectTimerRef.current = window.setInterval(() => {
      if (videoRef.current && videoRef.current.readyState >= 2 && !isProcessing) {
        const result = captureAndCompressFrame(videoRef.current);
        if (result) {
          const presence = checkFacePresence(result.imageData);
          if (presence.hasFace) {
            onCaptureFrame(result.base64, result.imageData);
          }
        }
      }
    }, 1200);

    return () => {
      if (autoDetectTimerRef.current) {
        clearInterval(autoDetectTimerRef.current);
      }
    };
  }, [isAutoDetect, cameraState, isProcessing, onCaptureFrame]);

  return (
    <div
      id="camera-container"
      className="card w-full max-w-[420px] mx-auto p-4 sm:p-5 relative transition-all"
    >
      {/* 顶部复古手账金属别针装饰（纤细素雅、顺眼自然） */}
      <div
        className="paper-clip-badge absolute -top-2.5 left-1/2 -translate-x-1/2 z-25 pointer-events-none select-none flex items-center justify-center opacity-85 transition-opacity"
        title="手账回形针"
      >
        <svg
          width="15"
          height="32"
          viewBox="0 0 16 34"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="filter drop-shadow-[0.5px_1px_1px_rgba(92,86,72,0.18)] -rotate-2"
        >
          <defs>
            <linearGradient id="naturalMetalClip" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#DFD8CD" />
              <stop offset="40%" stopColor="#BDB3A3" />
              <stop offset="80%" stopColor="#9C9282" />
              <stop offset="100%" stopColor="#7E7566" />
            </linearGradient>
          </defs>
          {/* 回形针纤细单线圈结构 */}
          <path
            d="M 6 12.5 V 23 C 6 25.8 10 25.8 10 23 V 7.5 C 10 3.8 3.5 3.8 3.5 7.5 V 25.5 C 3.5 31 12.5 31 12.5 25.5 V 10"
            stroke="url(#naturalMetalClip)"
            strokeWidth="1.45"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* 极其微弱的顶端高光 */}
          <path
            d="M 7.8 4.6 C 6.5 4.6 4.8 5.1 4.2 6.8"
            stroke="#FFFFFF"
            strokeWidth="0.7"
            strokeLinecap="round"
            opacity="0.65"
          />
        </svg>
      </div>

      {/* 取景框顶部微型状态与操作栏 */}
      <div className="flex items-center justify-between pb-3 px-1 text-xs">
        <div className="flex items-center space-x-1.5 font-gaegu text-base text-[#5C5648]">
          <span
            className={`w-2 h-2 rounded-full inline-block ${
              cameraState === 'active'
                ? isProcessing
                  ? 'bg-[#E5A99B] animate-ping'
                  : 'bg-[#7EA885] animate-pulse'
                : 'bg-[#C27D6B]'
            }`}
          />
          <span className="font-semibold">
            {cameraState === 'active'
              ? facingMode === 'user'
                ? '前置取景中'
                : '后置环境镜头'
              : '取景器待命'}
          </span>
        </div>

        <div className="flex items-center space-x-2">
          {/* 切换前后置镜头 */}
          <button
            id="toggle-facing-camera-btn"
            type="button"
            onClick={toggleFacingMode}
            className="p-1.5 rounded-lg border border-[#D6CEC1] bg-[#F3EFE6] hover:bg-[#EAE3D6] text-[#5C5648] transition-all active:scale-95 flex items-center space-x-1"
            title="切换前后置镜头"
          >
            <FlipHorizontal className="w-3.5 h-3.5 text-[#B25A45]" />
            <span className="font-gaegu text-sm">翻转镜头</span>
          </button>
        </div>
      </div>

      {/* 相机视窗（采用 Variation 7 的拍立得纸张嵌入风格） */}
      <div
        style={{
          aspectRatio: '4/5',
          background: '#EEE8DE',
          borderRadius: '16px',
          border: '3px solid #D6CEC1',
          overflow: 'hidden',
          position: 'relative'
        }}
        className="w-full flex items-center justify-center shadow-inner"
      >
        {/* 实时视频 */}
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className={`w-full h-full object-cover transform ${facingMode === 'user' ? 'scale-x-[-1]' : ''}`}
        />

        {/* 拍照快门白色闪光反馈 */}
        {isFlashActive && (
          <div className="absolute inset-0 bg-white/90 z-40 animate-out fade-out duration-200 pointer-events-none" />
        )}

        {/* 拍立得复古对准参考框 */}
        {cameraState === 'active' && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-10">
            <div className="relative w-56 h-72 sm:w-64 sm:h-80">
              {/* 椭圆参考轮廓（带有复古手绘邮票感边框） */}
              <div
                className={`w-full h-full rounded-[50%/40%] border-2 transition-colors duration-300 ${
                  hasError
                    ? 'border-[#C27D6B] shadow-[0_0_15px_rgba(194,125,107,0.4)]'
                    : isProcessing
                    ? 'border-[#E5A99B] border-dashed shadow-[0_0_20px_rgba(229,169,155,0.6)]'
                    : 'border-[#7EA885]/80 shadow-[0_0_12px_rgba(126,168,133,0.3)]'
                }`}
              >
                {/* 扫描线动画 */}
                {isProcessing && (
                  <div className="w-full h-1 bg-gradient-to-r from-transparent via-[#E5A99B] to-transparent shadow-[0_0_8px_#E5A99B] animate-[bounce_1.5s_infinite]" />
                )}
              </div>

              {/* 四角定位十字标 */}
              <div className="absolute top-0 left-0 w-5 h-5 border-t-2 border-l-2 border-[#5C5648]/60 rounded-tl -translate-x-1.5 -translate-y-1.5" />
              <div className="absolute top-0 right-0 w-5 h-5 border-t-2 border-r-2 border-[#5C5648]/60 rounded-tr translate-x-1.5 -translate-y-1.5" />
              <div className="absolute bottom-0 left-0 w-5 h-5 border-b-2 border-l-2 border-[#5C5648]/60 rounded-bl -translate-x-1.5 translate-y-1.5" />
              <div className="absolute bottom-0 right-0 w-5 h-5 border-b-2 border-r-2 border-[#5C5648]/60 rounded-br translate-x-1.5 translate-y-1.5" />

              {/* 顶部引导小标签 */}
              <div className="absolute -top-7 inset-x-0 text-center">
                <span className="font-gaegu text-xs text-[#5C5648] bg-[#FFFCF8]/90 px-2.5 py-0.5 rounded-full border border-[#D6CEC1] shadow-xs">
                  人脸请居中对准参考线
                </span>
              </div>
            </div>
          </div>
        )}

        {/* 摄像头受阻 / 未就绪状态视图（直接对齐 Variation 7 的设计规范） */}
        {cameraState !== 'active' && (
          <div className="absolute inset-0 bg-[#EEE8DE] flex flex-col items-center justify-center p-6 text-center z-30 space-y-3 font-gaegu">
            {cameraState === 'requesting' ? (
              <>
                <RefreshCw className="w-9 h-9 text-[#B25A45] animate-spin" />
                <p className="text-lg text-[#5C5648]">正在调起手机摄像头...</p>
                <p className="text-xs font-sans text-[#8E8675]">若弹出权限提示，请点击“允许”</p>
              </>
            ) : (
              <>
                <div style={{ color: '#A59E92' }} className="flex flex-col items-center justify-center space-y-2">
                  {cameraState === 'unsupported' ? (
                    <CameraOff className="w-11 h-11 text-[#C27D6B]/80" />
                  ) : (
                    <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                      <circle cx="12" cy="13" r="4" />
                    </svg>
                  )}
                  <p className="text-base text-[#8E8675]">
                    {cameraState === 'unsupported' ? '浏览器未支持直接调起摄像头' : '摄像头暂未连接'}
                  </p>
                </div>
                <p className="text-xs font-sans text-[#7D7667] max-w-xs leading-relaxed px-2">
                  {errorMessage}
                </p>

                {/* 隐藏的本地图片选择器 */}
                <input
                  type="file"
                  ref={fileInputRef}
                  accept="image/*"
                  onChange={handleFileUpload}
                  className="hidden"
                />

                <div className="flex flex-col sm:flex-row items-center justify-center gap-2 pt-1 font-sans">
                  {cameraState !== 'unsupported' && (
                    <button
                      id="retry-camera-btn"
                      onClick={startCamera}
                      className="stamp-button px-3.5 py-1.5 rounded-lg text-xs font-medium text-[#4A453B] flex items-center space-x-1.5"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>重新连接</span>
                    </button>
                  )}

                  <button
                    id="upload-fallback-btn"
                    onClick={() => fileInputRef.current?.click()}
                    className="stamp-button stamp-button-primary px-3.5 py-1.5 rounded-lg text-xs font-bold text-[#382A25] flex items-center space-x-1.5 shadow-xs"
                    title="选择本地自拍照进行人脸比对打卡"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>上传照片打卡</span>
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* 实时状态提示条 */}
      <div className="mt-3 px-3 py-1.5 rounded-xl bg-[#F4EFE6] border border-[#E3DCD1] flex items-center justify-between text-xs">
        <div className="flex items-center space-x-2 truncate">
          {isProcessing ? (
            <Sparkles className="w-4 h-4 text-[#E5A99B] animate-spin shrink-0" />
          ) : hasError ? (
            <AlertTriangle className="w-4 h-4 text-[#C27D6B] shrink-0" />
          ) : (
            <ShieldCheck className="w-4 h-4 text-[#7EA885] shrink-0" />
          )}
          <span className={`font-gaegu text-base truncate ${hasError ? 'text-[#C27D6B]' : 'text-[#4A453B]'}`}>
            {statusText}
          </span>
        </div>
        <span className="mono text-[10px] shrink-0 ml-2">640×480</span>
      </div>

      {/* Variation 7 标志性双邮票按钮网格 (Stamp Buttons) */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <button
          id="toggle-auto-detect-btn"
          type="button"
          onClick={() => setIsAutoDetect(!isAutoDetect)}
          className={`stamp-button py-3 px-2 rounded-xl text-lg flex items-center justify-center space-x-1.5 ${
            isAutoDetect ? 'bg-[rgba(229,169,155,0.22)] font-bold' : 'opacity-70'
          }`}
        >
          <span>{isAutoDetect ? '● 自动感应中' : '○ 自动感应关'}</span>
        </button>

        <button
          id="manual-checkin-btn"
          type="button"
          onClick={handleManualCapture}
          disabled={cameraState !== 'active' || isProcessing}
          className="stamp-button stamp-button-primary py-3 px-2 rounded-xl text-lg font-bold flex items-center justify-center space-x-1.5"
        >
          <UserCheck className="w-4 h-4" />
          <span>{isProcessing ? '比对中...' : '手动签到'}</span>
        </button>
      </div>
    </div>
  );
};
