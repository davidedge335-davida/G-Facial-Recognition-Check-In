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
  Upload,
  Zap,
  Volume2,
  VolumeX,
  RotateCcw,
  Check,
  CheckCircle2,
  AlertCircle,
  Clock,
  Sun,
  Pause
} from 'lucide-react';
import { captureAndCompressFrame, checkFacePresence, processImageFile } from '../utils/faceMatcher';
import { FastPassFeedback, CheckinLog } from '../types';

interface CameraViewProps {
  onCaptureFrame: (frameBase64: string, imageData: ImageData) => void;
  isProcessing: boolean;
  statusText: string;
  hasError: boolean;
  isFastPassMode?: boolean;
  onToggleFastPassMode?: (enabled: boolean) => void;
  fastPassFeedback?: FastPassFeedback | null;
  fastPassCount?: number;
  onResetFastPassCount?: () => void;
  isMuted?: boolean;
  onToggleMute?: () => void;
  isWakeLockActive?: boolean;
  recentFastPassUsers?: CheckinLog[];
  isPaused?: boolean;
}

export const CameraView: React.FC<CameraViewProps> = ({
  onCaptureFrame,
  isProcessing,
  statusText,
  hasError,
  isFastPassMode = false,
  onToggleFastPassMode = () => {},
  fastPassFeedback = null,
  fastPassCount = 0,
  onResetFastPassCount = () => {},
  isMuted = false,
  onToggleMute = () => {},
  isWakeLockActive = false,
  recentFastPassUsers = [],
  isPaused = false
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const isMountedRef = useRef<boolean>(true);
  const requestIdRef = useRef<number>(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cooldownUntilRef = useRef<number>(0);

  // 默认使用后置环境摄像头（更符合管理员持手持设备对准排队人群连续核销的真实场景），支持持久化与一键翻转
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>(() => {
    try {
      const saved = localStorage.getItem('face_checkin_facing_mode');
      if (saved === 'user' || saved === 'environment') return saved;
    } catch (e) {}
    return 'environment';
  });

  const [cameraState, setCameraState] = useState<'requesting' | 'active' | 'denied' | 'unsupported'>('requesting');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isFlashActive, setIsFlashActive] = useState<boolean>(false);
  const [isAutoDetect, setIsAutoDetect] = useState<boolean>(true);
  const autoDetectTimerRef = useRef<number | null>(null);

  // 处于极速连续模式反馈时，设置 1000ms 识别冷却，防止同一位人员离开时被多次重复触发
  useEffect(() => {
    if (fastPassFeedback) {
      cooldownUntilRef.current = Date.now() + 1050;
    }
  }, [fastPassFeedback]);

  // 极速模式开启时自动激活自动感应
  useEffect(() => {
    if (isFastPassMode) {
      setIsAutoDetect(true);
    }
  }, [isFastPassMode]);

  // 彻底停止并释放媒体流轨道
  const stopCurrentStream = useCallback(() => {
    if (streamRef.current) {
      try {
        streamRef.current.getTracks().forEach(track => {
          try {
            track.stop();
          } catch (e) {}
        });
      } catch (e) {}
      streamRef.current = null;
    }

    if (videoRef.current && videoRef.current.srcObject) {
      try {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => {
          try {
            track.stop();
          } catch (e) {}
        });
      } catch (e) {}
      videoRef.current.srcObject = null;
    }
  }, []);

  // 启动摄像头（带并发拦截、设备释放冷却与占线自愈重试）
  const startCamera = useCallback(async () => {
    const currentRequestId = ++requestIdRef.current;
    setCameraState('requesting');
    setErrorMessage('');

    stopCurrentStream();
    await new Promise(resolve => setTimeout(resolve, 200));

    if (!isMountedRef.current || requestIdRef.current !== currentRequestId) {
      return;
    }

    // 严谨检测环境是否支持 WebRTC 与媒体设备接口
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraState('unsupported');
      if (
        typeof window !== 'undefined' &&
        !window.isSecureContext &&
        window.location.protocol !== 'https:' &&
        window.location.hostname !== 'localhost'
      ) {
        setErrorMessage('当前页面未在安全上下文 (HTTPS) 中运行，浏览器禁用了摄像头权限。请使用 HTTPS 访问，或通过下方按钮上传自拍照打卡。');
      } else {
        setErrorMessage('当前浏览器环境不支持直接调起摄像头。您仍可通过下方按钮选择自拍照打卡。');
      }
      return;
    }

    // 增加 12 秒安全超时，同时拦截晚到的授权媒体流，杜绝设备占用与硬件指示灯常亮泄漏
    const getUserMediaWithTimeout = (constraints: MediaStreamConstraints, timeoutMs = 12000): Promise<MediaStream> => {
      let timer: number | null = null;
      let isTerminated = false;

      // 附加流到达监听，若用户在超时后才在系统弹窗点击“允许”，立即静默关闭所有音视频轨道，杜绝设备占用与媒体流泄漏
      const streamPromise = navigator.mediaDevices.getUserMedia(constraints)
        .then(stream => {
          if (isTerminated || requestIdRef.current !== currentRequestId || !isMountedRef.current) {
            try {
              stream.getTracks().forEach(track => {
                try { track.stop(); } catch (e) {}
              });
            } catch (e) {}
            throw new Error('CAMERA_STREAM_TERMINATED_LATE');
          }
          return stream;
        });

      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => {
          isTerminated = true;
          reject(new Error('CAMERA_TIMEOUT'));
        }, timeoutMs);
      });

      return Promise.race([streamPromise, timeoutPromise]).finally(() => {
        if (timer) clearTimeout(timer);
      });
    };

    try {
      let stream: MediaStream;
      try {
        const preferredConstraints: MediaStreamConstraints = {
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 24, max: 30 }
          },
          audio: false
        };
        stream = await getUserMediaWithTimeout(preferredConstraints);
      } catch (initialErr: any) {
        if (initialErr.message === 'CAMERA_TIMEOUT') {
          throw initialErr;
        }

        const errMsg = String(initialErr.message || '').toLowerCase();
        const errName = String(initialErr.name || '');
        if (
          errName === 'NotAllowedError' ||
          errName === 'PermissionDeniedError' ||
          errName === 'NotFoundError' ||
          errName === 'DevicesNotFoundError'
        ) {
          throw initialErr;
        }

        // 占线或约束不匹配，延迟 350ms 降级为基础视频约束
        await new Promise(resolve => setTimeout(resolve, 350));
        if (!isMountedRef.current || requestIdRef.current !== currentRequestId) return;

        stream = await getUserMediaWithTimeout({
          video: true,
          audio: false
        });
      }

      if (!isMountedRef.current || requestIdRef.current !== currentRequestId) {
        stream.getTracks().forEach(t => t.stop());
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

  // 本地照片上传打卡降级方案（结合文件大小限制、零拷贝内存保护与解码异常友好提示）
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError(null);

    try {
      const result = await processImageFile(file);
      setIsFlashActive(true);
      setTimeout(() => setIsFlashActive(false), 200);
      onCaptureFrame(result.base64, result.imageData);
    } catch (err: any) {
      console.warn('本地照片打卡处理异常:', err);
      setUploadError(err.message || '照片读取解码失败，请换一张清晰正脸照片');
    } finally {
      e.target.value = '';
    }
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

  // 手动截帧打卡（当暂停或处理中时禁用，防止并发重复签到）
  const handleManualCapture = () => {
    if (!videoRef.current || cameraState !== 'active' || isProcessing || isPaused) return;

    setIsFlashActive(true);
    setTimeout(() => setIsFlashActive(false), 200);

    const result = captureAndCompressFrame(videoRef.current);
    if (result) {
      onCaptureFrame(result.base64, result.imageData);
    }
  };

  // 翻转摄像头并持久化记忆，方便下次保持相同方向
  const toggleFacingMode = () => {
    setFacingMode(prev => {
      const next = prev === 'user' ? 'environment' : 'user';
      try {
        localStorage.setItem('face_checkin_facing_mode', next);
      } catch (e) {}
      return next;
    });
  };

  // 自动检测轮询：当 isPaused（如弹窗展示中、页面切后台）时立即停止识别，杜绝 2.8 秒内重复扫脸提交
  useEffect(() => {
    if (!isAutoDetect || cameraState !== 'active' || isProcessing || isPaused) {
      if (autoDetectTimerRef.current) {
        clearInterval(autoDetectTimerRef.current);
        autoDetectTimerRef.current = null;
      }
      return;
    }

    const intervalMs = isFastPassMode ? 750 : 1200;

    autoDetectTimerRef.current = window.setInterval(() => {
      if (
        videoRef.current &&
        videoRef.current.readyState >= 2 &&
        !isProcessing &&
        !isPaused &&
        Date.now() >= cooldownUntilRef.current
      ) {
        const result = captureAndCompressFrame(videoRef.current);
        if (result) {
          const presence = checkFacePresence(result.imageData);
          if (presence.hasFace) {
            onCaptureFrame(result.base64, result.imageData);
          }
        }
      }
    }, intervalMs);

    return () => {
      if (autoDetectTimerRef.current) {
        clearInterval(autoDetectTimerRef.current);
      }
    };
  }, [isAutoDetect, cameraState, isProcessing, isPaused, isFastPassMode, onCaptureFrame]);

  return (
    <div
      id="camera-container"
      className="card w-full max-w-[420px] mx-auto p-4 sm:p-5 relative transition-all"
    >
      {/* 顶部复古手账金属别针装饰（与上方活页笔记本打孔环相呼应） */}
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
          <path
            d="M 6 12.5 V 23 C 6 25.8 10 25.8 10 23 V 7.5 C 10 3.8 3.5 3.8 3.5 7.5 V 25.5 C 3.5 31 12.5 31 12.5 25.5 V 10"
            stroke="url(#naturalMetalClip)"
            strokeWidth="1.45"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M 7.8 4.6 C 6.5 4.6 4.8 5.1 4.2 6.8"
            stroke="#FFFFFF"
            strokeWidth="0.7"
            strokeLinecap="round"
            opacity="0.65"
          />
        </svg>
      </div>

      {/* ---------------- 连续极速打卡排队设置便签条（手账便签风格，手机端宽松两段式布局） ---------------- */}
      <div
        id="fast-pass-mode-bar"
        className={`mb-3 p-2.5 sm:p-3 rounded-xl border-2 transition-all ${
          isFastPassMode
            ? 'bg-[#EFF5EF] border-[#7EA885] shadow-xs'
            : 'bg-[#F7F4EB] border-[#E3DCD1]'
        }`}
      >
        {/* 第一行：模式主开关与标题（绝不折行） */}
        <div className="flex items-center justify-between gap-2">
          <button
            id="toggle-fast-pass-btn"
            type="button"
            onClick={() => onToggleFastPassMode(!isFastPassMode)}
            className="flex items-center space-x-2 text-left group cursor-pointer focus:outline-none min-w-0"
            title={isFastPassMode ? '点击切换为常规印章弹窗模式' : '点击开启连续极速排队秒过模式'}
          >
            <div
              className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-all ${
                isFastPassMode
                  ? 'bg-[#4C7253] text-white shadow-xs'
                  : 'bg-[#E5DFD3] text-[#7D7667] group-hover:bg-[#D9D2C4]'
              }`}
            >
              <Zap className={`w-4 h-4 ${isFastPassMode ? 'fill-current' : ''}`} />
            </div>
            <div className="flex items-center space-x-1.5 min-w-0">
              <span className="font-gaegu text-lg font-bold text-[#4A453B] whitespace-nowrap">
                极速排队模式
              </span>
              <span
                className={`text-[11px] font-gaegu px-2 py-0.5 rounded-full border whitespace-nowrap shrink-0 ${
                  isFastPassMode
                    ? 'bg-[#7EA885]/20 text-[#3B5D41] border-[#7EA885]/70 font-bold'
                    : 'bg-white text-[#8E8675] border-[#D6CEC1]'
                }`}
              >
                {isFastPassMode ? '● 连刷中' : '○ 未开启'}
              </span>
            </div>
          </button>

          {/* 右侧开关滑块（复古手账滑动开关，操作直观且不挤占文字空间） */}
          <button
            type="button"
            onClick={() => onToggleFastPassMode(!isFastPassMode)}
            className={`w-11 h-6 rounded-full p-0.5 transition-colors duration-200 ease-in-out cursor-pointer shrink-0 border ${
              isFastPassMode
                ? 'bg-[#4C7253] border-[#3B5D41]'
                : 'bg-[#DCD4C7] border-[#C8BEAE]'
            }`}
            title={isFastPassMode ? '点击关闭极速排队' : '点击开启极速排队'}
          >
            <div
              className={`w-4.5 h-4.5 rounded-full bg-white shadow-xs transform transition-transform duration-200 ease-in-out flex items-center justify-center ${
                isFastPassMode ? 'translate-x-5' : 'translate-x-0'
              }`}
            >
              {isFastPassMode ? (
                <Check className="w-2.5 h-2.5 text-[#4C7253] stroke-[3]" />
              ) : (
                <span className="w-1.5 h-1.5 rounded-full bg-[#B5ACA0]" />
              )}
            </div>
          </button>
        </div>

        {/* 第二行：说明文案与辅助工具栏（充足呼吸空间，彻底解决手机端拥挤） */}
        <div className="mt-2 pt-1.5 border-t border-[#E3DCD1]/60 flex items-center justify-between gap-2 text-xs">
          <p className="text-[11px] text-[#7D7667] truncate min-w-0">
            {isFastPassMode ? '免弹窗阻断 · 叮声秒验 · 自动归位' : '刷脸后展示拍立得弹窗与专属印章'}
          </p>

          {/* 极速模式下的便携工具栏 */}
          {isFastPassMode && (
            <div className="flex items-center space-x-1.5 shrink-0">
              {/* 屏幕常亮徽标 */}
              {isWakeLockActive && (
                <span
                  className="hidden xxs:inline-flex items-center text-[10px] font-gaegu text-[#4C7253] bg-white px-1.5 py-0.5 rounded-md border border-[#7EA885]/40 whitespace-nowrap shadow-2xs"
                  title="屏幕保持常亮，防止排队熄屏"
                >
                  <Sun className="w-2.5 h-2.5 mr-0.5" />
                  常亮
                </span>
              )}

              {/* 静音切换 */}
              <button
                id="toggle-sound-btn"
                type="button"
                onClick={onToggleMute}
                className="stamp-button p-1 rounded-md border border-[#D6CEC1] bg-white text-[#5C5648] transition-colors cursor-pointer"
                title={isMuted ? '取消静音 (当前静音)' : '开启提示音'}
              >
                {isMuted ? (
                  <VolumeX className="w-3.5 h-3.5 text-[#B25A45]" />
                ) : (
                  <Volume2 className="w-3.5 h-3.5 text-[#4C7253]" />
                )}
              </button>

              {/* 快速通行计数纸签 */}
              <div
                className="inline-flex items-center space-x-1 bg-white border border-[#7EA885]/70 rounded-md px-1.5 py-0.5 shadow-2xs whitespace-nowrap"
                title="本轮快速通行已核验人数"
              >
                <span className="text-[10px] text-[#7D7667]">已过:</span>
                <span className="font-mono text-xs font-bold text-[#3B5D41] animate-counter-pulse">
                  {fastPassCount}
                </span>
                <button
                  type="button"
                  onClick={onResetFastPassCount}
                  className="text-[#8E8675] hover:text-[#4A453B] ml-0.5 cursor-pointer"
                  title="重置本轮计数"
                >
                  <RotateCcw className="w-2.5 h-2.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 取景框顶部微型状态与操作栏 */}
      <div className="flex items-center justify-between pb-2.5 px-1 text-xs gap-2">
        <div className="flex items-center space-x-1.5 font-gaegu text-base text-[#5C5648] min-w-0">
          <span
            className={`w-2 h-2 rounded-full inline-block shrink-0 ${
              cameraState === 'active'
                ? isProcessing
                  ? 'bg-[#E5A99B] animate-ping'
                  : isFastPassMode
                  ? 'bg-[#4C7253] animate-pulse ring-2 ring-[#7EA885]/40'
                  : 'bg-[#7EA885] animate-pulse'
                : 'bg-[#C27D6B]'
            }`}
          />
          <span className="font-semibold truncate">
            {cameraState === 'active'
              ? isFastPassMode
                ? '极速排队待命中 · 随时刷脸'
                : facingMode === 'user'
                ? '前置镜头取景中'
                : '后置环境镜头'
              : '取景器待命'}
          </span>
        </div>

        <div className="flex items-center space-x-2 shrink-0">
          {/* 切换前后置镜头 */}
          <button
            id="toggle-facing-camera-btn"
            type="button"
            onClick={toggleFacingMode}
            className="stamp-button px-2 py-1 rounded-lg border border-[#D6CEC1] bg-[#F3EFE6] hover:bg-[#EAE3D6] text-[#5C5648] flex items-center space-x-1 text-xs whitespace-nowrap cursor-pointer"
            title="切换前后置镜头"
          >
            <FlipHorizontal className="w-3.5 h-3.5 text-[#B25A45]" />
            <span className="font-gaegu text-sm">翻转镜头</span>
          </button>
        </div>
      </div>

      {/* 相机视窗：拍立得相纸取景框（手机端方正紧凑 1:1 比例，大屏 4:5，大幅精简移动端首屏高度） */}
      <div
        id="camera-viewfinder-window"
        style={{
          background: '#EEE8DE',
          borderRadius: '16px',
          border: isFastPassMode ? '3px solid #7EA885' : '3px solid #D6CEC1',
          overflow: 'hidden',
          position: 'relative'
        }}
        className={`w-full aspect-square max-h-[250px] sm:aspect-[4/5] sm:max-h-[380px] flex items-center justify-center shadow-inner transition-colors duration-300 ${
          fastPassFeedback?.type === 'success'
            ? 'animate-fastpass-success-flash'
            : fastPassFeedback?.type === 'repeated' || fastPassFeedback?.type === 'not_found'
            ? 'animate-fastpass-warning-flash'
            : ''
        }`}
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

        {/* 弹窗核销或后台时的暂停识别角标 */}
        {isPaused && (
          <div className="absolute top-2.5 right-2.5 z-40 bg-[#382A25]/85 text-[#F5F0E6] text-[11px] font-gaegu px-2.5 py-1 rounded-full border border-[#D6CEC1]/40 flex items-center space-x-1.5 shadow-md backdrop-blur-xs">
            <Pause className="w-3 h-3 text-[#E5A99B] fill-current" />
            <span>识别已暂停</span>
          </div>
        )}

        {/* ---------------- 连续极速模式：轻量无感 HUD 悬浮横幅 (Non-Blocking HUD) ---------------- */}
        {isFastPassMode && fastPassFeedback && (
          <div className="absolute top-3 inset-x-3 z-40 animate-fastpass-hud-enter pointer-events-none">
            {fastPassFeedback.type === 'success' && (
              <div className="bg-[#FCFBF7]/95 backdrop-blur-md border-2 border-[#4C7253] rounded-2xl p-2.5 shadow-2xl flex items-center justify-between text-[#4A453B]">
                <div className="flex items-center space-x-2.5 min-w-0">
                  <div className="relative shrink-0">
                    <img
                      src={fastPassFeedback.user?.avatarUrl}
                      alt={fastPassFeedback.user?.name}
                      className="w-11 h-11 rounded-xl object-cover border border-[#4C7253]/50 shadow-xs"
                    />
                    <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-[#4C7253] text-white rounded-full flex items-center justify-center shadow-xs">
                      <Check className="w-2.5 h-2.5 stroke-[3]" />
                    </div>
                  </div>
                  <div className="min-w-0 text-left">
                    <div className="flex items-center space-x-1.5">
                      <span className="font-gaegu text-2xl font-bold text-[#3B5D41] truncate leading-none">
                        {fastPassFeedback.user?.name}
                      </span>
                      <span className="text-[10px] font-mono text-[#8E8675] truncate">
                        {fastPassFeedback.user?.studentId}
                      </span>
                    </div>
                    <div className="text-[11px] text-[#5C5648] truncate -mt-0.5">
                      {fastPassFeedback.user?.department}
                    </div>
                  </div>
                </div>

                <div className="flex flex-col items-end shrink-0 pl-2">
                  <span className="vintage-stamp-green text-sm px-2.5 py-0.5 font-bold shadow-xs whitespace-nowrap">
                    APPROVED · 签到成功
                  </span>
                  <span className="text-[10px] font-mono text-[#8E8675] mt-0.5">
                    {fastPassFeedback.time}
                  </span>
                </div>
              </div>
            )}

            {fastPassFeedback.type === 'repeated' && (
              <div className="bg-[#FCFBF7]/95 backdrop-blur-md border-2 border-[#B25A45] rounded-2xl p-2.5 shadow-2xl flex items-center justify-between text-[#4A453B]">
                <div className="flex items-center space-x-2.5 min-w-0">
                  <Clock className="w-9 h-9 text-[#B25A45] shrink-0 p-1.5 bg-[#B25A45]/10 rounded-xl" />
                  <div className="min-w-0 text-left">
                    <div className="font-gaegu text-xl font-bold text-[#B25A45] truncate">
                      {fastPassFeedback.user?.name} · 已签到
                    </div>
                    <div className="text-[11px] text-[#7D7667] truncate">
                      防重冷却中，请直接快速入场
                    </div>
                  </div>
                </div>
                <span className="vintage-stamp text-xs px-2 py-0.5 font-bold shadow-xs shrink-0">
                  请直接通行
                </span>
              </div>
            )}

            {fastPassFeedback.type === 'not_found' && (
              <div className="bg-[#FCFBF7]/95 backdrop-blur-md border-2 border-[#C27D6B] rounded-2xl p-2.5 shadow-2xl flex items-center justify-between text-[#4A453B]">
                <div className="flex items-center space-x-2.5 min-w-0">
                  <AlertCircle className="w-8 h-8 text-[#C27D6B] shrink-0" />
                  <div className="min-w-0 text-left">
                    <div className="font-gaegu text-xl font-bold text-[#C27D6B]">
                      未匹配到底库人员
                    </div>
                    <div className="text-[11px] text-[#7D7667]">
                      请走人工登记通道核验
                    </div>
                  </div>
                </div>
                <span className="font-gaegu text-xs bg-[#EEE8DE] px-2 py-1 rounded-lg text-[#8E8675] shrink-0">
                  自动复位中
                </span>
              </div>
            )}
          </div>
        )}

        {/* 拍立得复古对准参考框（按取景框适配比例收敛尺寸，保证完整居中不超出灰色视窗） */}
        {cameraState === 'active' && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-10 p-2">
            <div className="relative w-[150px] h-[190px] sm:w-[185px] sm:h-[235px]">
              {/* 椭圆参考轮廓 */}
              <div
                className={`w-full h-full rounded-[50%/40%] border-2 transition-colors duration-300 ${
                  hasError
                    ? 'border-[#C27D6B] shadow-[0_0_12px_rgba(194,125,107,0.4)]'
                    : isProcessing
                    ? 'border-[#E5A99B] border-dashed shadow-[0_0_16px_rgba(229,169,155,0.6)]'
                    : isFastPassMode
                    ? 'border-[#4C7253]/85 shadow-[0_0_12px_rgba(76,114,83,0.35)]'
                    : 'border-[#7EA885]/85 shadow-[0_0_10px_rgba(126,168,133,0.3)]'
                }`}
              >
                {/* 扫描线动画 */}
                {isProcessing && (
                  <div className="w-full h-1 bg-gradient-to-r from-transparent via-[#E5A99B] to-transparent shadow-[0_0_8px_#E5A99B] animate-[bounce_1.5s_infinite]" />
                )}
              </div>

              {/* 四角定位十字标 */}
              <div
                className={`absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 rounded-tl -translate-x-1 -translate-y-1 transition-colors ${
                  isFastPassMode ? 'border-[#4C7253]' : 'border-[#5C5648]/60'
                }`}
              />
              <div
                className={`absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 rounded-tr translate-x-1 -translate-y-1 transition-colors ${
                  isFastPassMode ? 'border-[#4C7253]' : 'border-[#5C5648]/60'
                }`}
              />
              <div
                className={`absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 rounded-bl -translate-x-1 translate-y-1 transition-colors ${
                  isFastPassMode ? 'border-[#4C7253]' : 'border-[#5C5648]/60'
                }`}
              />
              <div
                className={`absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 rounded-br translate-x-1 translate-y-1 transition-colors ${
                  isFastPassMode ? 'border-[#4C7253]' : 'border-[#5C5648]/60'
                }`}
              />

              {/* 顶部引导小标签（绝对居中且不折行，保证完整单行显示） */}
              <div className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap z-20 pointer-events-none">
                <span
                  className={`inline-flex items-center font-gaegu text-[11px] sm:text-xs px-2.5 py-0.5 rounded-full border shadow-xs transition-colors backdrop-blur-xs whitespace-nowrap leading-tight ${
                    isFastPassMode
                      ? 'bg-[#EBF3EC]/95 text-[#3B5D41] border-[#7EA885] font-bold'
                      : 'bg-[#FFFCF8]/95 text-[#5C5648] border-[#D6CEC1]'
                  }`}
                >
                  {isFastPassMode ? '⚡ 极速连续感应中 · 站稳即过' : '人脸请居中对准参考线'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* 摄像头受阻 / 未就绪状态视图 */}
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

      {/* 本地照片解析错误提示条 */}
      {uploadError && (
        <div role="alert" className="mt-2.5 p-2 rounded-xl bg-[#F8EAE7] border border-[#E5A99B] text-xs text-[#C27D6B] flex items-start space-x-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="flex-1">{uploadError}</span>
          <button
            type="button"
            onClick={() => setUploadError(null)}
            className="text-[#8E8675] hover:text-[#4A453B] font-bold px-1"
          >
            ×
          </button>
        </div>
      )}

      {/* 实时状态提示条（手账便签风格） */}
      <div className="mt-3 px-3 py-1.5 rounded-xl bg-[#F5F0E6] border border-[#E3DCD1] flex items-center justify-between text-xs">
        <div className="flex items-center space-x-2 truncate">
          {isProcessing ? (
            <Sparkles className="w-4 h-4 text-[#E5A99B] animate-spin shrink-0" />
          ) : hasError ? (
            <AlertTriangle className="w-4 h-4 text-[#C27D6B] shrink-0" />
          ) : isFastPassMode ? (
            <Zap className="w-4 h-4 text-[#4C7253] shrink-0 fill-current" />
          ) : isPaused ? (
            <Pause className="w-4 h-4 text-[#B25A45] shrink-0" />
          ) : (
            <ShieldCheck className="w-4 h-4 text-[#7EA885] shrink-0" />
          )}
          <span className={`font-gaegu text-base truncate ${hasError ? 'text-[#C27D6B]' : 'text-[#4A453B]'}`}>
            {isPaused ? '识别弹窗展示中，已暂停扫描' : statusText}
          </span>
        </div>
        <span className="mono text-[10px] shrink-0 ml-2">640×480</span>
      </div>

      {/* 底部操作按钮：复古实木/火漆印章质感按钮 */}
      <div className="mt-3.5 grid grid-cols-2 gap-3">
        <button
          id="toggle-auto-detect-btn"
          type="button"
          onClick={() => setIsAutoDetect(!isAutoDetect)}
          className={`stamp-button py-2.5 px-2 rounded-xl text-base flex items-center justify-center space-x-1.5 font-gaegu ${
            isAutoDetect ? 'bg-[rgba(126,168,133,0.22)] font-bold text-[#3B5D41]' : 'opacity-75'
          }`}
        >
          <span>{isAutoDetect ? '● 自动感应开启' : '○ 自动感应关闭'}</span>
        </button>

        <button
          id="manual-checkin-btn"
          type="button"
          onClick={handleManualCapture}
          disabled={cameraState !== 'active' || isProcessing || isPaused}
          className={`stamp-button stamp-button-primary py-2.5 px-2 rounded-xl text-base font-bold flex items-center justify-center space-x-1.5 font-gaegu ${
            isPaused ? 'opacity-60 cursor-not-allowed' : ''
          }`}
        >
          <UserCheck className="w-4 h-4" />
          <span>{isProcessing ? '比对中...' : isPaused ? '已暂停' : isFastPassMode ? '手动秒核验' : '手动签到'}</span>
        </button>
      </div>

      {/* 连续排队模式下的即时流水展示条 (Live Pass Ticker，手账邮票小签) */}
      {isFastPassMode && recentFastPassUsers && recentFastPassUsers.length > 0 && (
        <div className="mt-3 pt-2.5 border-t border-[#E3DCD1]/80">
          <div className="flex items-center justify-between text-[11px] text-[#7D7667] mb-1 font-gaegu">
            <span>🏃 最近快速通行流水：</span>
            <span>共 {fastPassCount} 人</span>
          </div>
          <div className="flex items-center space-x-2 overflow-x-auto pb-1 scrollbar-none">
            {recentFastPassUsers.slice(0, 4).map(log => (
              <div
                key={log.id}
                className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-lg bg-[#EBF3EC] border border-[#7EA885]/50 text-[#3B5D41] text-[11px] font-gaegu shrink-0 shadow-2xs"
              >
                <CheckCircle2 className="w-3 h-3 text-[#4C7253]" />
                <span className="font-bold">{log.name}</span>
                <span className="text-[10px] text-[#7D7667] font-mono">
                  {log.checkinTime.split(' ')[1] || log.checkinTime}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
