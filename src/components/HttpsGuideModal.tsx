import React, { useState } from 'react';
import { ShieldCheck, Copy, Check, X, AlertTriangle, BookOpen } from 'lucide-react';

interface HttpsGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const HttpsGuideModal: React.FC<HttpsGuideModalProps> = ({ isOpen, onClose }) => {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  if (!isOpen) return null;

  const copyCode = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#4A453B]/50 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="card w-full max-w-lg p-6 relative text-[#5C5648] max-h-[90vh] overflow-y-auto space-y-4 shadow-2xl">
        {/* 和纸胶带装饰 */}
        <div
          className="washi-tape"
          style={{ top: '-11px', left: '40px', width: '80px', transform: 'rotate(-2deg)' }}
        />

        {/* 顶部标题与关闭 */}
        <div className="flex items-center justify-between pb-3 border-b border-[#E3DCD1]">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-[rgba(229,169,155,0.2)] text-[#B25A45] rounded-xl border border-[#E5A99B]/50">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-xl font-bold font-gaegu text-[#4A453B]">手机真机与局域网调试手册</h3>
              <p className="mono text-[#8E8675]">HTTPS & WebRTC Guide for Mobile</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-[#EEE8DE] text-[#8E8675] hover:text-[#4A453B] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 提示便签 */}
        <div className="p-3 bg-[#F4EFE6] border border-[#D6CEC1] rounded-xl flex items-start space-x-2 text-xs text-[#5C5648]">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-[#B25A45]" />
          <span>
            W3C 规范规定：除 <code className="bg-[#EAE3D6] px-1 py-0.5 rounded mono text-[#4A453B]">http://localhost</code> 外，
            所有手机移动端浏览器（Safari、Chrome、微信）调用 <code className="bg-[#EAE3D6] px-1 py-0.5 rounded mono text-[#4A453B]">getUserMedia</code> 均必须运行在 <strong>HTTPS</strong> 安全上下文下。
          </span>
        </div>

        {/* 调试指引卡片 */}
        <div className="space-y-3 text-xs">
          {/* 方案一 */}
          <div className="p-3.5 bg-[#FFFCF8] rounded-xl border border-[#E3DCD1] space-y-1.5 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="font-bold font-gaegu text-base text-[#4A453B]">
                方案 1：AI Studio 云端环境（原生自带 HTTPS）
              </span>
              <span className="vintage-stamp-green text-xs px-2 py-0.5">免配置</span>
            </div>
            <p className="text-[#7D7667] leading-relaxed">
              直接在手机浏览器或扫码打开本项目的 Cloud Run 域名链接（以 https:// 开头），即符合 W3C 规范，可直接调起前后置摄像头打卡。
            </p>
          </div>

          {/* 方案二 */}
          <div className="p-3.5 bg-[#FFFCF8] rounded-xl border border-[#E3DCD1] space-y-2 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="font-bold font-gaegu text-base text-[#4A453B]">
                方案 2：局域网使用 mkcert 生成本地证书
              </span>
              <span className="vintage-stamp text-xs px-2 py-0.5">本地调试</span>
            </div>
            <p className="text-[#7D7667]">
              在开发电脑上安装 mkcert 并为局域网 IP（例如 192.168.1.100）签发自签证书：
            </p>
            <div className="relative bg-[#EEE8DE] border border-[#D6CEC1] p-2.5 rounded-lg mono text-[11px] text-[#4A453B] flex items-center justify-between">
              <span>mkcert 192.168.1.100 localhost 127.0.0.1</span>
              <button
                onClick={() => copyCode("mkcert 192.168.1.100 localhost 127.0.0.1", 1)}
                className="text-[#8E8675] hover:text-[#4A453B] ml-2 shrink-0 p-1 hover:bg-[#E0D9CD] rounded"
              >
                {copiedIndex === 1 ? <Check className="w-3.5 h-3.5 text-[#4C7253]" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
            <p className="text-[#8E8675] text-[11px]">
              将生成的 rootCA 安装并信任到手机，在 Vite 中配置 https 选项即可。
            </p>
          </div>

          {/* 方案三 */}
          <div className="p-3.5 bg-[#FFFCF8] rounded-xl border border-[#E3DCD1] space-y-2 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="font-bold font-gaegu text-base text-[#4A453B]">
                方案 3：安卓 Chrome 白名单免证书免签
              </span>
              <span className="vintage-stamp text-xs px-2 py-0.5">免证书</span>
            </div>
            <p className="text-[#7D7667]">
              安卓手机在 Chrome 地址栏访问调试开关：
            </p>
            <div className="relative bg-[#EEE8DE] border border-[#D6CEC1] p-2 rounded-lg mono text-[11px] text-[#B25A45] flex items-center justify-between">
              <span>chrome://flags/#unsafely-treat-insecure-origin-as-secure</span>
              <button
                onClick={() => copyCode("chrome://flags/#unsafely-treat-insecure-origin-as-secure", 2)}
                className="text-[#8E8675] hover:text-[#4A453B] ml-2 shrink-0 p-1 hover:bg-[#E0D9CD] rounded"
              >
                {copiedIndex === 2 ? <Check className="w-3.5 h-3.5 text-[#4C7253]" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
            <p className="text-[#8E8675] text-[11px]">
              将电脑局域网 IP（如 http://192.168.1.100:3000）填入白名单并设为 Enabled，重启 Chrome 即可。
            </p>
          </div>
        </div>

        <button
          onClick={onClose}
          className="stamp-button stamp-button-primary w-full py-2.5 rounded-xl text-lg font-bold font-gaegu transition-all"
        >
          我已了解，返回主页
        </button>
      </div>
    </div>
  );
};
