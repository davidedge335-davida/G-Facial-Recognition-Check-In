import React, { useState } from 'react';
import { BookOpen, Check, Copy, X } from 'lucide-react';
import { JournalDialog } from './JournalDialog';

interface HttpsGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const HttpsGuideModal: React.FC<HttpsGuideModalProps> = ({ isOpen, onClose }) => {
  const [copyMessage, setCopyMessage] = useState('');
  if (!isOpen) return null;

  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText('mkcert 192.168.1.100 localhost 127.0.0.1');
      setCopyMessage('已复制');
    } catch {
      setCopyMessage('复制未成功，请手动选中命令复制');
    }
  };

  return (
    <JournalDialog labelledBy="guide-title" onClose={onClose} className="w-full max-w-lg p-6 sm:p-8 relative">
      <div className="flex items-start justify-between gap-3 pb-4 border-b border-[#E3DCD1]">
        <div><span className="journal-eyebrow">A LITTLE HELP / 使用指南</span><h2 id="guide-title" className="text-2xl text-[#343E35] mt-2">摄像头使用小贴士</h2></div>
        <button onClick={onClose} aria-label="关闭使用指南" className="p-2 text-[#73786B] rounded-full hover:bg-[#F0F0E6]"><X size={19} /></button>
      </div>
      <div className="guide-step"><span>01</span><div><h3>先给镜头一个许可</h3><p>在浏览器弹出的提示中选择“允许”。如果之前拒绝过，请打开地址栏旁的网站权限设置，允许使用摄像头后重新连接。</p></div></div>
      <div className="guide-step"><span>02</span><div><h3>让镜头留给这一次见面</h3><p>关闭正在使用摄像头的视频会议或其他网页，再点击“重新连接摄像头”。尽量在光线均匀的位置，将面部放入参考框。</p></div></div>
      <div className="guide-step"><span>03</span><div><h3>用浏览器打开安全链接</h3><p>手机上请使用以 <strong>https://</strong> 开头的地址。如应用内无法唤起镜头，可以复制链接到手机系统浏览器中打开。</p></div></div>
      {/* 开发调试说明放进折页，日常签到用户可以先读懂上面的三步。 */}
      <details className="mt-5 rounded-lg border border-[#D6CEC1] bg-[#F4F1E7] p-4 text-xs">
        <summary className="cursor-pointer text-[#596C4F]"><BookOpen className="inline-block w-4 h-4 mr-2" />给管理员：本机与局域网调试</summary>
        <p className="mt-4 leading-7">电脑本机可使用 localhost；手机访问电脑的局域网地址时，需要配置 HTTPS。可使用 mkcert 生成开发证书，IP 请替换为开发电脑的实际地址。</p>
        <div className="mt-3 rounded border border-[#D6CEC1] bg-[#FFFDF7] p-3 flex items-start gap-3">
          <code className="min-w-0 flex-1 leading-6">mkcert 192.168.1.100 localhost 127.0.0.1</code>
          <button onClick={copyCommand} aria-label="复制证书命令" className="p-1 text-[#526B50]">{copyMessage === '已复制' ? <Check size={16} /> : <Copy size={16} />}</button>
        </div>
        <p role="status" className="mt-2 text-[#526B50]">{copyMessage}</p>
        <p className="mt-3 leading-7">在手机安装并信任开发 CA 证书，并在 Vite 的 server.https 中配置生成的证书和密钥。生产环境应使用受信任的 HTTPS 证书。</p>
      </details>
      <button onClick={onClose} className="stamp-button stamp-button-primary w-full py-3 rounded-lg mt-6">知道了，回去签到</button>
    </JournalDialog>
  );
};
