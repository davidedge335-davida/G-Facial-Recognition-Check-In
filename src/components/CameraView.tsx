import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Camera, RefreshCw, FlipHorizontal, AlertTriangle, Sparkles, UserCheck, Check } from 'lucide-react';
import { captureAndCompressFrame, checkFacePresence } from '../utils/faceMatcher';

interface CameraViewProps {
  onCaptureFrame: (frameBase64: string, imageData: ImageData) => void;
  isProcessing: boolean;
  isPaused?: boolean;
  statusText: string;
  hasError: boolean;
}

export const CameraView: React.FC<CameraViewProps> = ({
  onCaptureFrame,
  isProcessing,
  isPaused = false,
  statusText,
  hasError
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const isMountedRef = useRef<boolean>(true);
  const requestIdRef = useRef<number>(0);

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

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      // 明确进入不支持状态，避免一直显示请求中的加载动画。
      setCameraState('unsupported');
      setErrorMessage('您的浏览器不支持调用摄像头（请确保在 HTTPS 或 localhost 环境下访问）');
      return;
    }

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
        stream = await navigator.mediaDevices.getUserMedia(preferredConstraints);
      } catch (initialErr: any) {
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

          stream = await navigator.mediaDevices.getUserMedia({
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
        videoRef.current.onloadedmetadata = () => {
          if (videoRef.current && isMountedRef.current && requestIdRef.current === currentRequestId) {
            videoRef.current.play().catch(e => console.warn('自动播放受阻:', e));
            setCameraState('active');
          }
        };
      }
    } catch (err: any) {
      if (!isMountedRef.current || requestIdRef.current !== currentRequestId) return;
      console.warn('摄像头调用状态:', err.message || err.name);
      setCameraState('denied');

      const errMsg = String(err.message || '').toLowerCase();
      const errName = String(err.name || '');

      if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
        setErrorMessage('摄像头权限被拒绝，请在手机浏览器设置中允许本站访问摄像头。');
      } else if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
        setErrorMessage('未检测到可用的摄像头硬件设备。');
      } else if (errName === 'NotReadableError' || errName === 'TrackStartError' || errMsg.includes('in use')) {
        setErrorMessage('摄像头已被其他软件或网页占用 (Device in use)。可尝试关闭占用软件或点击“释放并重连”。');
      } else {
        setErrorMessage(`摄像头启动受阻: ${err.message || '请确认摄像头未被占用'}`);
      }
    }
  }, [facingMode, stopCurrentStream]);

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
    if (!videoRef.current || cameraState !== 'active' || isProcessing || isPaused) return;

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
    // 结果卡片展示期间暂停自动识别，避免新一轮检测覆盖当前反馈。
    if (!isAutoDetect || cameraState !== 'active' || isProcessing || isPaused) {
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
  }, [isAutoDetect, cameraState, isProcessing, isPaused, onCaptureFrame]);

  return (
    <div id="camera-container" className="camera-polaroid">
      <div className="camera-washi" aria-hidden="true" />
      <div className="camera-toolbar">
        <span className="camera-state"><span className={`small-dot ${cameraState === 'active' ? 'is-live' : ''}`} />
          {cameraState === 'active' ? (facingMode === 'user' ? '前置取景中' : '后置取景中') : cameraState === 'requesting' ? '正在连接镜头' : '镜头尚未连接'}
        </span>
        <button id="toggle-facing-camera-btn" type="button" onClick={toggleFacingMode} disabled={cameraState !== 'active' || isProcessing} className="camera-flip" title="切换前后置镜头">
          <FlipHorizontal size={15} /><span>翻转镜头</span>
        </button>
      </div>

      <div className="camera-viewport">
        <video ref={videoRef} playsInline muted autoPlay aria-label="摄像头实时取景" className={`camera-video ${facingMode === 'user' ? 'camera-mirrored' : ''}`} />
        {isFlashActive && <div className="camera-flash" aria-hidden="true" />}
        {cameraState === 'active' && (
          <div className={`camera-overlay ${hasError ? 'has-error' : ''}`} aria-hidden="true">
            <span className="viewfinder-label">请将面部对准参考框</span>
            <div className={`face-guide ${isProcessing ? 'is-scanning' : ''}`}><i /><i /><i /><i />{isProcessing && <span className="scan-line" />}</div>
          </div>
        )}

        {cameraState !== 'active' && (
          <div className="camera-placeholder" role="status">
            <span className="placeholder-corner corner-tl" aria-hidden="true" /><span className="placeholder-corner corner-tr" aria-hidden="true" />
            <span className="placeholder-corner corner-bl" aria-hidden="true" /><span className="placeholder-corner corner-br" aria-hidden="true" />
            <div className="camera-illustration" aria-hidden="true"><Camera size={48} strokeWidth={1.15} /><span className="illustration-spark">✳</span></div>
            <span className="placeholder-eyebrow">A MOMENT FOR TODAY</span>
            <h2>{cameraState === 'requesting' ? '和今天，打个照面' : '镜头里的你，即将登场'}</h2>
            <p>{cameraState === 'requesting' ? '正在连接摄像头，请在浏览器提示中选择“允许”。' : errorMessage}</p>
            {cameraState === 'requesting' ? (
              <span className="camera-connecting"><RefreshCw size={14} className="animate-spin" /> 等待摄像头授权</span>
            ) : (
              <button id="retry-camera-btn" onClick={startCamera} className="camera-retry"><RefreshCw size={15} /><span>重新连接摄像头</span></button>
            )}
            <span className="placeholder-footnote">自然一点，微笑就好。</span>
          </div>
        )}
      </div>

      <div className={`capture-status ${hasError ? 'has-error' : ''}`} role="status" aria-live="polite">
        {isProcessing ? <Sparkles size={16} className="animate-pulse" /> : hasError ? <AlertTriangle size={16} /> : <SmileIcon />}
        <span>{cameraState === 'active' || isProcessing || hasError ? statusText : '准备好后，留下今天的第一份记录'}</span>
      </div>
      <button id="manual-checkin-btn" type="button" onClick={handleManualCapture} disabled={cameraState !== 'active' || isProcessing || isPaused} className="checkin-button">
        {isProcessing ? <RefreshCw size={19} className="animate-spin" /> : <UserCheck size={19} />}<span>{isProcessing ? '正在识别，请稍候…' : '微笑，签到'}</span><span className="button-arrow" aria-hidden="true">↗</span>
      </button>
      <div className="camera-bottomline">
        <button id="toggle-auto-detect-btn" type="button" role="switch" aria-checked={isAutoDetect} aria-label="自动签到" onClick={() => setIsAutoDetect(!isAutoDetect)} className="auto-detect-toggle">
          <span className={`toggle-track ${isAutoDetect ? 'is-on' : ''}`} aria-hidden="true"><span>{isAutoDetect && <Check size={9} />}</span></span>
          <span>自动签到{isAutoDetect ? '已开启' : '已关闭'}</span>
        </button>
        <span>保持面部清晰</span>
      </div>
    </div>
  );
};

function SmileIcon() {
  return <span className="status-smile" aria-hidden="true">☺</span>;
}
