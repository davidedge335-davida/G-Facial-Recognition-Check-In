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
      setErrorMessage('用户名或密码错误，请核对后重试（初始账号：admin，密码：admin123）');
    }
  };

  const handleFillDefaults = () => {
    setUsername(validUsername);
    setPassword(validPassword);
    setErrorMessage('');
  };

  return (
    <div className="w-full max-w-md mx-auto py-8 px-4">
      {/* 登录卡片 */}
      <div className="card p-6 sm:p-8 relative space-y-6">
        {/* 顶部金属回形针装饰 */}
        <div className="paper-clip" />

        {/* 标题与图标 */}
        <div className="text-center space-y-2">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-[#EEE8DE] border-2 border-[#D6CEC1] flex items-center justify-center text-[#B25A45] shadow-inner">
            <Lock className="w-7 h-7" />
          </div>
          <h2 className="font-gaegu text-3xl font-bold text-[#4A453B]">
            管理后台验证
          </h2>
          <p className="mono text-xs text-[#8E8675] uppercase tracking-wider">
            INSIGHTFACE X FEISHU · /ADMIN
          </p>
        </div>

        {/* 初始账号密码提示徽章 */}
        <div className="p-3 rounded-xl bg-[#F4EFE6] border border-[#D6CEC1] space-y-1.5 text-xs text-[#5C5648]">
          <div className="flex items-center space-x-1.5 text-[#B25A45] font-bold font-gaegu text-base">
            <ShieldCheck className="w-4 h-4" />
            <span>初始凭证已就绪</span>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-[11px] mono text-[#7D7667]">
            <span>账号: <strong className="text-[#4A453B]">{validUsername}</strong></span>
            <span>密码: <strong className="text-[#4A453B]">{validPassword}</strong></span>
          </div>
          <button
            type="button"
            id="fill-default-creds-btn"
            onClick={handleFillDefaults}
            className="w-full mt-1 py-1 px-2 rounded-lg bg-[#FFFCF8] hover:bg-[#EEE8DE] border border-[#D6CEC1] text-[#5C5648] text-[11px] font-gaegu text-sm transition-all"
          >
            一键填入初始账号密码
          </button>
        </div>

        {/* 错误提示 */}
        {errorMessage && (
          <div className="p-2.5 rounded-xl bg-[#F8EAE7] border border-[#E5A99B] text-xs text-[#C27D6B] flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* 登录表单 */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="font-gaegu text-base text-[#4A453B] font-semibold flex items-center space-x-1">
              <User className="w-3.5 h-3.5 text-[#8E8675]" />
              <span>管理员账号</span>
            </label>
            <input
              id="admin-username-input"
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="请输入管理员账号 (admin)"
              className="w-full px-3.5 py-2.5 bg-[#EEE8DE] border border-[#D6CEC1] rounded-xl text-sm text-[#4A453B] placeholder-[#8E8675] focus:outline-none focus:border-[#B25A45] transition-colors"
              autoFocus
            />
          </div>

          <div className="space-y-1">
            <label className="font-gaegu text-base text-[#4A453B] font-semibold flex items-center space-x-1">
              <KeyRound className="w-3.5 h-3.5 text-[#8E8675]" />
              <span>登录密码</span>
            </label>
            <div className="relative">
              <input
                id="admin-password-input"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="请输入密码 (admin123)"
                className="w-full pl-3.5 pr-10 py-2.5 bg-[#EEE8DE] border border-[#D6CEC1] rounded-xl text-sm text-[#4A453B] placeholder-[#8E8675] focus:outline-none focus:border-[#B25A45] transition-colors"
              />
              <button
                type="button"
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
