import React, { useState, useEffect, useCallback } from 'react';
import {
  Wrench,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  RefreshCw,
  Camera,
  Smartphone,
  ShieldCheck,
  Globe,
  ExternalLink,
  X,
  HelpCircle,
  ChevronRight,
  Sparkles
} from 'lucide-react';
import { JournalDialog } from './JournalDialog';

interface DiagnosticResult {
  id: string;
  name: string;
  status: 'checking' | 'pass' | 'warning' | 'fail';
  summary: string;
  detail?: string;
}

interface CameraTroubleshootModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRetryCamera: () => Promise<void> | void;
  currentError?: string;
}

export const CameraTroubleshootModal: React.FC<CameraTroubleshootModalProps> = ({
  isOpen,
  onClose,
  onRetryCamera,
  currentError = ''
}) => {
  const [diagnostics, setDiagnostics] = useState<DiagnosticResult[]>([]);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [isRetrying, setIsRetrying] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'ios' | 'android' | 'wechat'>('ios');
  const [actionFeedback, setActionFeedback] = useState<string>('');

  // 运行全自动诊断体检
  const runDiagnostics = useCallback(async () => {
    setIsRunning(true);
    setActionFeedback('');

    const results: DiagnosticResult[] = [
      {
        id: 'secure-context',
        name: '安全运行环境 (HTTPS/Localhost)',
        status: 'checking',
        summary: '正在检测页面安全上下文协议...'
      },
      {
        id: 'webrtc-support',
        name: 'WebRTC 多媒体接口支持',
        status: 'checking',
        summary: '正在检测浏览器多媒体内核支持...'
      },
      {
        id: 'camera-hardware',
        name: '摄像头硬件检测',
        status: 'checking',
        summary: '正在探测可用视频输入设备...'
      },
      {
        id: 'permission-status',
        name: '浏览器摄像头授权状态',
        status: 'checking',
        summary: '正在查询系统权限授权标记...'
      }
    ];

    setDiagnostics([...results]);

    // 1. 安全上下文检测
    const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
    const isLocal =
      typeof window !== 'undefined' &&
      ['localhost', '127.0.0.1'].includes(window.location.hostname);
    const isSecure = typeof window !== 'undefined' && (window.isSecureContext ?? (isHttps || isLocal));

    if (isSecure) {
      results[0] = {
        id: 'secure-context',
        name: '安全运行环境 (HTTPS)',
        status: 'pass',
        summary: '已处于安全加密上下文 (HTTPS 或 Localhost)',
        detail: '满足现代手机浏览器调用摄像头必须的加密安全规范。'
      };
    } else {
      results[0] = {
        id: 'secure-context',
        name: '安全运行环境 (HTTP 警告)',
        status: 'fail',
        summary: '当前正在使用非安全 HTTP 访问',
        detail: '手机浏览器因安全策略，非 localhost 且非 HTTPS 网址会无条件禁用摄像头 API，请切换至 HTTPS 地址。'
      };
    }
    setDiagnostics([...results]);

    // 2. WebRTC 接口支持检测
    const hasMediaDevices =
      typeof navigator !== 'undefined' &&
      Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

    if (hasMediaDevices) {
      results[1] = {
        id: 'webrtc-support',
        name: 'WebRTC 多媒体接口',
        status: 'pass',
        summary: 'navigator.mediaDevices.getUserMedia 支持正常',
        detail: '当前浏览器支持标准的现场实时视频捕获。'
      };
    } else {
      results[1] = {
        id: 'webrtc-support',
        name: 'WebRTC 多媒体接口',
        status: 'fail',
        summary: '当前浏览器缺少 getUserMedia 接口',
        detail: '可能使用了老旧浏览器或受限的应用内嵌 WebView，建议使用手机自带系统浏览器。'
      };
    }
    setDiagnostics([...results]);

    // 3. 硬件设备检测
    try {
      if (typeof navigator !== 'undefined' && navigator.mediaDevices?.enumerateDevices) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(d => d.kind === 'videoinput');
        if (videoDevices.length > 0) {
          results[2] = {
            id: 'camera-hardware',
            name: '摄像头硬件设备',
            status: 'pass',
            summary: `已检测到 ${videoDevices.length} 个视频摄像头设备`,
            detail: videoDevices.map((d, i) => d.label || `镜头 ${i + 1}`).join('，')
          };
        } else {
          results[2] = {
            id: 'camera-hardware',
            name: '摄像头硬件设备',
            status: 'warning',
            summary: '未枚举到视频摄像头（或权限被拒受阻）',
            detail: '可能镜头正被其他应用占用，或浏览器尚未授权因而无法获取设备列表。'
          };
        }
      } else {
        results[2] = {
          id: 'camera-hardware',
          name: '摄像头硬件设备',
          status: 'warning',
          summary: '暂无法直接枚举硬件设备',
          detail: '需要先获得摄像头基本授权后方可列出可用设备。'
        };
      }
    } catch (e: any) {
      results[2] = {
        id: 'camera-hardware',
        name: '摄像头硬件设备',
        status: 'warning',
        summary: '硬件探测受阻',
        detail: e.message || '系统限制了设备查询'
      };
    }
    setDiagnostics([...results]);

    // 4. 权限状态检测
    try {
      if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
        // @ts-ignore
        const permission = await navigator.permissions.query({ name: 'camera' });
        if (permission.state === 'granted') {
          results[3] = {
            id: 'permission-status',
            name: '系统相机权限状态',
            status: 'pass',
            summary: '系统权限：已允许 (Granted)',
            detail: '浏览器已获取摄像头权限，可随时启动流。'
          };
        } else if (permission.state === 'denied') {
          results[3] = {
            id: 'permission-status',
            name: '系统相机权限状态',
            status: 'fail',
            summary: '系统权限：已被拒绝 (Denied)',
            detail: '系统或浏览器此前曾点击过“拒绝”，请参照下方指引在设置中重新开启。'
          };
        } else {
          results[3] = {
            id: 'permission-status',
            name: '系统相机权限状态',
            status: 'warning',
            summary: '系统权限：待用户确认授权 (Prompt)',
            detail: '点击“重新调起摄像头”时，请注意观察屏幕弹出的系统授权对话框并点击“允许”。'
          };
        }
      } else {
        results[3] = {
          id: 'permission-status',
          name: '系统相机权限状态',
          status: 'warning',
          summary: '此浏览器需通过实际调起触发授权',
          detail: 'iOS Safari 等浏览器保护隐私，不支持直接读取权限状态，请点击下方按钮重新唤起。'
        };
      }
    } catch (e) {
      results[3] = {
        id: 'permission-status',
        name: '系统相机权限状态',
        status: 'warning',
        summary: '需实际调起验证',
        detail: '请点击下方“重新调起摄像头”触发系统授权弹窗。'
      };
    }

    setDiagnostics([...results]);
    setIsRunning(false);
  }, []);

  useEffect(() => {
    if (isOpen) {
      // 自动侦测当前操作系统并预设 Tab
      if (typeof navigator !== 'undefined') {
        const ua = navigator.userAgent.toLowerCase();
        if (ua.includes('micromessenger') || ua.includes('dingtalk') || ua.includes('feishu')) {
          setActiveTab('wechat');
        } else if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod')) {
          setActiveTab('ios');
        } else if (ua.includes('android')) {
          setActiveTab('android');
        }
      }
      runDiagnostics();
    }
  }, [isOpen, runDiagnostics]);

  if (!isOpen) return null;

  // 触发重新调用摄像头
  const handleRetry = async () => {
    setIsRetrying(true);
    setActionFeedback('正在向浏览器发起摄像头调起请求...');
    try {
      await onRetryCamera();
      setActionFeedback('已触发摄像头调起，请在系统提示中点击【允许】！');
      // 延时重新诊断并关闭
      setTimeout(() => {
        setIsRetrying(false);
        onClose();
      }, 1200);
    } catch (err: any) {
      setIsRetrying(false);
      setActionFeedback(`调用受阻: ${err.message || '请查看下方图文指引在系统设置中允许'}`);
      runDiagnostics();
    }
  };

  return (
    <JournalDialog labelledBy="troubleshoot-title" onClose={onClose} className="w-full max-w-xl p-5 sm:p-7 relative max-h-[90vh] overflow-y-auto">
      {/* 顶部手账风格标题 */}
      <div className="flex items-start justify-between gap-3 pb-3 border-b border-[#E3DCD1]">
        <div className="text-left">
          <div className="flex items-center space-x-1.5">
            <span className="journal-eyebrow">CAMERA DIAGNOSTICS</span>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-mono bg-[#EBF3EC] text-[#3B5D41] border border-[#7EA885]/40 font-bold">
              真人实核 · 禁相册防作弊
            </span>
          </div>
          <h2 id="troubleshoot-title" className="text-2xl text-[#343E35] font-gaegu font-bold mt-1 flex items-center space-x-2">
            <Wrench className="w-5 h-5 text-[#B25A45]" />
            <span>摄像头一键排查与权限诊断</span>
          </h2>
        </div>
        <button
          onClick={onClose}
          aria-label="关闭排查诊断"
          className="p-1.5 text-[#73786B] rounded-full hover:bg-[#F0F0E6] cursor-pointer"
        >
          <X size={20} />
        </button>
      </div>

      {/* 真人出镜规范小贴士 */}
      <div className="mt-3 p-2.5 rounded-xl bg-[#FFFDF7] border border-[#E3DCD1] text-xs text-[#5C5648] flex items-start space-x-2.5 shadow-2xs">
        <ShieldCheck className="w-4 h-4 text-[#4C7253] shrink-0 mt-0.5" />
        <div className="text-left leading-relaxed">
          <span className="font-bold text-[#3B5D41]">规范提示：</span>
          为保障考勤与活动打卡真实有效，系统严格要求<strong>现场真人出镜</strong>，已彻底<strong>禁用相册或静态图片上传</strong>。请参考下列体检结果解决摄像头调起问题。
        </div>
      </div>

      {/* 错误速报（若已有确切错误） */}
      {currentError && (
        <div className="mt-2.5 p-2 rounded-xl bg-[#F8EAE7] border border-[#E5A99B] text-xs text-[#B25A45] flex items-start space-x-2 text-left">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="flex-1 font-mono text-[11px] leading-relaxed">当前拦截反馈: {currentError}</span>
        </div>
      )}

      {/* 诊断体检清单卡片 */}
      <div className="mt-3.5 card p-3 sm:p-4 bg-[#F8F5EE] border border-[#D6CEC1]/80 space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="font-gaegu text-lg font-bold text-[#4A453B] flex items-center space-x-1.5">
            <Sparkles className="w-4 h-4 text-[#7EA885]" />
            <span>智能体检检测结果</span>
          </span>
          <button
            type="button"
            onClick={runDiagnostics}
            disabled={isRunning}
            className="stamp-button text-xs px-2.5 py-1 rounded-md text-[#5C5648] flex items-center space-x-1 cursor-pointer"
          >
            <RefreshCw className={`w-3 h-3 ${isRunning ? 'animate-spin text-[#B25A45]' : ''}`} />
            <span>{isRunning ? '检测中...' : '重新检测'}</span>
          </button>
        </div>

        <div className="space-y-2">
          {diagnostics.map(item => (
            <div
              key={item.id}
              className="p-2.5 rounded-lg bg-white border border-[#E3DCD1] flex items-start space-x-2.5 text-left transition-all shadow-2xs"
            >
              <div className="shrink-0 mt-0.5">
                {item.status === 'checking' && (
                  <RefreshCw className="w-4 h-4 text-[#8E8675] animate-spin" />
                )}
                {item.status === 'pass' && (
                  <CheckCircle2 className="w-4 h-4 text-[#4C7253]" />
                )}
                {item.status === 'warning' && (
                  <AlertTriangle className="w-4 h-4 text-[#D9822B]" />
                )}
                {item.status === 'fail' && (
                  <AlertCircle className="w-4 h-4 text-[#B25A45]" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-[#4A453B]">{item.name}</span>
                  <span
                    className={`text-[10px] font-gaegu px-1.5 py-0.2 rounded border ${
                      item.status === 'pass'
                        ? 'bg-[#EBF3EC] text-[#3B5D41] border-[#7EA885]/40'
                        : item.status === 'fail'
                        ? 'bg-[#F8EAE7] text-[#B25A45] border-[#E5A99B]'
                        : item.status === 'warning'
                        ? 'bg-[#FEF7EC] text-[#B36B00] border-[#E0B253]/60'
                        : 'bg-[#F4F1E7] text-[#7D7667] border-[#D6CEC1]'
                    }`}
                  >
                    {item.status === 'pass'
                      ? '正常'
                      : item.status === 'fail'
                      ? '异常'
                      : item.status === 'warning'
                      ? '提示'
                      : '检测中'}
                  </span>
                </div>
                <p className="text-xs text-[#5C5648] mt-0.5 leading-snug">{item.summary}</p>
                {item.detail && (
                  <p className="text-[11px] text-[#8E8675] mt-1 leading-normal bg-[#FBF9F4] p-1.5 rounded border border-[#EDE7DD]">
                    {item.detail}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 快捷主操作：直接重新调起授权 */}
      <div className="mt-3.5 space-y-1.5">
        <button
          type="button"
          onClick={handleRetry}
          disabled={isRetrying}
          className="stamp-button stamp-button-primary w-full py-3 rounded-xl text-base font-gaegu font-bold flex items-center justify-center space-x-2 shadow-sm cursor-pointer"
        >
          <Camera className={`w-5 h-5 ${isRetrying ? 'animate-bounce' : ''}`} />
          <span>{isRetrying ? '正在唤起手机摄像头授权...' : '📸 立即重新调起手机摄像头'}</span>
        </button>

        {actionFeedback && (
          <p className="text-xs text-[#4C7253] text-center font-gaegu animate-pulse">
            {actionFeedback}
          </p>
        )}
      </div>

      {/* 针对不同机型与浏览器的详细开启指引 */}
      <div className="mt-4 pt-3 border-t border-[#E3DCD1] text-left">
        <div className="flex items-center justify-between mb-2">
          <span className="font-gaegu text-base font-bold text-[#4A453B]">
            📱 手机浏览器权限解除指引
          </span>
          <div className="inline-flex rounded-lg border border-[#D6CEC1] p-0.5 bg-[#F5F0E6] text-xs font-gaegu">
            <button
              type="button"
              onClick={() => setActiveTab('ios')}
              className={`px-2 py-0.5 rounded-md cursor-pointer transition-colors ${
                activeTab === 'ios' ? 'bg-white shadow-2xs font-bold text-[#3B5D41]' : 'text-[#7D7667]'
              }`}
            >
              苹果 iOS
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('android')}
              className={`px-2 py-0.5 rounded-md cursor-pointer transition-colors ${
                activeTab === 'android' ? 'bg-white shadow-2xs font-bold text-[#3B5D41]' : 'text-[#7D7667]'
              }`}
            >
              安卓 Android
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('wechat')}
              className={`px-2 py-0.5 rounded-md cursor-pointer transition-colors ${
                activeTab === 'wechat' ? 'bg-white shadow-2xs font-bold text-[#3B5D41]' : 'text-[#7D7667]'
              }`}
            >
              微信/应用内
            </button>
          </div>
        </div>

        {activeTab === 'ios' && (
          <div className="p-3 rounded-xl bg-white border border-[#E3DCD1] text-xs space-y-2 text-[#5C5648]">
            <div className="flex items-start space-x-2">
              <span className="font-mono text-xs font-bold px-1.5 py-0.5 rounded bg-[#F3EFE6] text-[#B25A45]">1</span>
              <div>
                <strong>Safari 地址栏快速解禁：</strong>
                <p className="text-[#7D7667] mt-0.5">点击 Safari 底部或顶部地址栏左侧的<strong>“大小”或“🔒”</strong>图标 ➔ 点击<strong>【网站设置】</strong> ➔ 将<strong>【相机】</strong>改为<strong>“允许”</strong>。</p>
              </div>
            </div>
            <div className="flex items-start space-x-2">
              <span className="font-mono text-xs font-bold px-1.5 py-0.5 rounded bg-[#F3EFE6] text-[#B25A45]">2</span>
              <div>
                <strong>若全局权限未开启：</strong>
                <p className="text-[#7D7667] mt-0.5">打开手机桌面<strong>【设置】</strong> ➔ 找到<strong>【Safari 浏览器】</strong> ➔ 滚动到底部<strong>【相机】</strong> ➔ 改为<strong>“允许”</strong>或“询问”。</p>
              </div>
            </div>
            <div className="flex items-start space-x-2">
              <span className="font-mono text-xs font-bold px-1.5 py-0.5 rounded bg-[#F3EFE6] text-[#B25A45]">3</span>
              <div>
                <strong>刷新页面：</strong>
                <p className="text-[#7D7667] mt-0.5">回到网页下拉刷新，再次点击“重新调起手机摄像头”。</p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'android' && (
          <div className="p-3 rounded-xl bg-white border border-[#E3DCD1] text-xs space-y-2 text-[#5C5648]">
            <div className="flex items-start space-x-2">
              <span className="font-mono text-xs font-bold px-1.5 py-0.5 rounded bg-[#F3EFE6] text-[#4C7253]">1</span>
              <div>
                <strong>Chrome / 手机自带浏览器快速解锁：</strong>
                <p className="text-[#7D7667] mt-0.5">点击地址栏左侧的<strong>“🔒 锁头图标”或“设置图标”</strong> ➔ 点击<strong>【权限】或【网站设置】</strong> ➔ 开启<strong>【摄像头】</strong>开关。</p>
              </div>
            </div>
            <div className="flex items-start space-x-2">
              <span className="font-mono text-xs font-bold px-1.5 py-0.5 rounded bg-[#F3EFE6] text-[#4C7253]">2</span>
              <div>
                <strong>系统应用权限检查：</strong>
                <p className="text-[#7D7667] mt-0.5">手机【设置】 ➔【应用管理】 ➔ 找到当前浏览器 ➔【权限管理】 ➔ 确保<strong>“相机/摄像头”</strong>设置为<strong>“允许”</strong>。</p>
              </div>
            </div>
            <div className="flex items-start space-x-2">
              <span className="font-mono text-xs font-bold px-1.5 py-0.5 rounded bg-[#F3EFE6] text-[#4C7253]">3</span>
              <div>
                <strong>释放硬件占用：</strong>
                <p className="text-[#7D7667] mt-0.5">关闭后台正在运行的微信视频通话、相机拍照等软件，避免设备冲突。</p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'wechat' && (
          <div className="p-3 rounded-xl bg-white border border-[#E3DCD1] text-xs space-y-2 text-[#5C5648]">
            <div className="flex items-start space-x-2">
              <span className="font-mono text-xs font-bold px-1.5 py-0.5 rounded bg-[#F3EFE6] text-[#B25A45]">1</span>
              <div>
                <strong>推荐在系统默认浏览器中打开：</strong>
                <p className="text-[#7D7667] mt-0.5">点击右上角的<strong>【···】菜单</strong> ➔ 选择<strong>【在默认浏览器中打开】</strong>（Safari / Chrome）。许多内置聊天软件会禁用网页摄像头功能。</p>
              </div>
            </div>
            <div className="flex items-start space-x-2">
              <span className="font-mono text-xs font-bold px-1.5 py-0.5 rounded bg-[#F3EFE6] text-[#B25A45]">2</span>
              <div>
                <strong>微信内置权限授权：</strong>
                <p className="text-[#7D7667] mt-0.5">若仍需在微信内使用，请点击右上角【···】 ➔【设置】➔ 确认开启“允许网页使用摄像头”。</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 底部关闭按钮 */}
      <div className="mt-4 pt-3 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="stamp-button px-5 py-2 rounded-xl text-xs font-bold text-[#5C5648] cursor-pointer"
        >
          关闭返回
        </button>
      </div>
    </JournalDialog>
  );
};
