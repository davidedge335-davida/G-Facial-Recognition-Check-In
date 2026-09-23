import React, { useState } from 'react';
import { ShieldCheck, Lock, User, Eye, EyeOff, ArrowLeft, KeyRound, AlertCircle, CheckCircle2 } from 'lucide-react';

interface AdminLoginViewProps {
  onLoginSuccess: () => void;
  onBackToCheckin: () => void;
  validUsername: string;
  validPassword: string;
}

export const AdminLoginView: React.FC<AdminLoginViewProps> = ({
  onLoginSuccess,
  onBackToCheckin,
  validUsername,
  validPassword
}) => {
  const [username, setUsername] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    if (!username.trim()) {
      setErrorMessage('请输入管理员用户名');
      return;
    }
    if (!password) {
      setErrorMessage('请输入管理员密码');
      return;
    }

    if (username.trim() === validUsername && password === validPassword) {
      onLoginSuccess();
    } else {
      setErrorMessage('用户名或密码错误，请核对后重试');
    }
  };

  // 演示提示仅针对未修改的默认凭证，不展示用户后来设置的密码。
  const hasDefaultCredentials = validUsername === 'admin' && validPassword === 'admin123';
  const handleFillDefaults = () => {
    if (!hasDefaultCredentials) return;
    setUsername('admin');
    setPassword('admin123');
    setErrorMessage('');
  };

  return (
    <div className="w-full max-w-md mx-auto py-8 px-4">
      {/* 登录卡片 */}
      <div className="admin-login card p-6 sm:p-8 relative space-y-6">
        {/* 顶部金属回形针装饰 */}
        <div className="paper-clip" />

        {/* 标题与图标 */}
        <div className="text-center space-y-2">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-[#EEE8DE] border-2 border-[#D6CEC1] flex items-center justify-center text-[#B25A45] shadow-inner">
            <Lock className="w-7 h-7" />
          </div>
          <h2 className="font-gaegu text-3xl font-bold text-[#4A453B]">
            翻开管理手帐
          </h2>
          <p className="mono text-xs text-[#8E8675] uppercase tracking-wider">
            THE ORGANIZER · 管理员登录
          </p>
        </div>

        {/* 默认凭证收进说明折页，避免抢占登录主操作的视觉层级。 */}
        {hasDefaultCredentials && (
          <details className="rounded-lg border border-[#D6CEC1] bg-[#F4F1E7] p-3 text-xs">
            <summary className="cursor-pointer text-[#637255]">首次体验？查看本机演示账号</summary>
            <p className="py-3 text-[#6B705F]">账号：admin · 密码：admin123</p>
            <button type="button" id="fill-default-creds-btn" onClick={handleFillDefaults} className="journal-link">填入演示账号 <ArrowLeft className="w-3 h-3 rotate-180" /></button>
          </details>
        )}

        {/* 错误提示 */}
        {errorMessage && (
          <div role="alert" className="p-2.5 rounded-xl bg-[#F8EAE7] border border-[#E5A99B] text-xs text-[#C27D6B] flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* 登录表单 */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="admin-username-input" className="font-gaegu text-base text-[#4A453B] font-semibold flex items-center space-x-1">
              <User className="w-3.5 h-3.5 text-[#8E8675]" />
              <span>管理员账号</span>
            </label>
            <input
              id="admin-username-input"
              autoComplete="username"
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="请输入管理员账号 (admin)"
              className="w-full px-3.5 py-2.5 bg-[#EEE8DE] border border-[#D6CEC1] rounded-xl text-sm text-[#4A453B] placeholder-[#8E8675] focus:outline-none focus:border-[#B25A45] transition-colors"
              autoFocus
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="admin-password-input" className="font-gaegu text-base text-[#4A453B] font-semibold flex items-center space-x-1">
              <KeyRound className="w-3.5 h-3.5 text-[#8E8675]" />
              <span>登录密码</span>
            </label>
            <div className="relative">
              <input
                id="admin-password-input"
                autoComplete="current-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="请输入密码 (admin123)"
                className="w-full pl-3.5 pr-10 py-2.5 bg-[#EEE8DE] border border-[#D6CEC1] rounded-xl text-sm text-[#4A453B] placeholder-[#8E8675] focus:outline-none focus:border-[#B25A45] transition-colors"
              />
              <button
                type="button"
                aria-label={showPassword ? '隐藏密码' : '显示密码'}
                aria-pressed={showPassword}
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8E8675] hover:text-[#4A453B]"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            id="admin-login-submit-btn"
            type="submit"
            className="stamp-button stamp-button-primary w-full py-3 rounded-xl text-lg font-bold flex items-center justify-center space-x-2 mt-2"
          >
            <ShieldCheck className="w-5 h-5" />
            <span>登录管理后台</span>
          </button>
        </form>

        {/* 返回主页 */}
        <div className="pt-2 text-center border-t border-[#E3DCD1]">
          <button
            type="button"
            id="back-to-checkin-from-login-btn"
            onClick={onBackToCheckin}
            className="font-gaegu text-base text-[#8E8675] hover:text-[#B25A45] inline-flex items-center space-x-1 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>返回刷脸签到界面</span>
          </button>
        </div>
      </div>
    </div>
  );
};
