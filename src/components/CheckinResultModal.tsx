import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  CheckCircle2,
  AlertCircle,
  Clock,
  Send,
  X,
  Building2,
  ArrowRight,
  Stamp,
  Award,
  Sparkles,
  RotateCcw,
  Check
} from 'lucide-react';
import { CheckinResultState } from '../types';

interface CheckinResultModalProps {
  result: CheckinResultState | null;
  onClose: () => void;
}

// 模拟轻柔温润的木质印章敲击纸张触觉音效（Web Audio API 无损合成，无外链延迟）
const playStampHapticSound = () => {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(130, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(32, ctx.currentTime + 0.075);

    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.075);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.08);
  } catch (e) {
    // 忽略静音环境或浏览器音频策略限制
  }
};

export const CheckinResultModal: React.FC<CheckinResultModalProps> = ({ result, onClose }) => {
  const [countdown, setCountdown] = useState<number>(5);
  const [animationCycle, setAnimationCycle] = useState<number>(0);
  const soundPlayedRef = useRef<boolean>(false);

  // 触发动画与触击音效
  const triggerAnimation = useCallback(() => {
    setAnimationCycle(prev => prev + 1);
    // 在印章落定瞬间 (200ms) 播放纸张触击音
    window.setTimeout(() => {
      playStampHapticSound();
    }, 200);
  }, []);

  useEffect(() => {
    if (!result || (result.status !== 'success' && result.status !== 'repeated')) return;
    setCountdown(5);
    triggerAnimation();

    const timer = setInterval(() => {
      setCountdown(prev => Math.max(0, prev - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [result, triggerAnimation]);

  // 倒计时归零自动安全关闭
  useEffect(() => {
    if (countdown === 0 && result && (result.status === 'success' || result.status === 'repeated')) {
      onClose();
    }
  }, [countdown, result, onClose]);

  // 键盘快捷操作：按 ESC / Space / Enter 快速关闭，便于排队连续打卡
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!result || result.status === 'idle' || result.status === 'scanning') return null;

  const isSuccess = result.status === 'success';
  const isRepeated = result.status === 'repeated';
  const isFail = result.status === 'not_found' || result.status === 'error';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#4A453B]/55 backdrop-blur-[2px] animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        id="checkin-result-card"
        key={`modal-card-${animationCycle}`}
        onClick={e => e.stopPropagation()}
        className="card w-full max-w-sm p-6 relative overflow-visible text-[#5C5648] flex flex-col items-center text-center space-y-4 shadow-2xl animate-card-impact"
      >
        {/* 和纸胶带装饰 (Washi Tape) */}
        <div
          className="washi-tape"
          style={{ top: '-11px', left: '50%', transform: 'translateX(-50%) rotate(-1deg)', width: '90px' }}
        />

        {/* 顶部重播与关闭按钮 */}
        <div className="absolute top-3.5 right-3.5 flex items-center space-x-1">
          <button
            id="replay-stamp-anim-btn"
            onClick={triggerAnimation}
            title="重新播放印章动效"
            className="p-1.5 text-[#8E8675] hover:text-[#4A453B] rounded-full hover:bg-[#EEE8DE] transition-colors text-xs flex items-center"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button
            id="close-result-modal-btn"
            onClick={onClose}
            title="关闭 (Esc / Space)"
            className="p-1.5 text-[#8E8675] hover:text-[#4A453B] rounded-full hover:bg-[#EEE8DE] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 第一阶段：立体印章从 Z 轴俯冲落下 (Stamp Drop & Ink Spread) */}
        <div className="pt-2 relative flex items-center justify-center min-h-[52px]">
          {/* 触击墨水扩散环 (Ink Shockwave Ring) */}
          <div
            className={`absolute inset-0 -m-1 rounded-xl pointer-events-none animate-ink-spread border-2 ${
              isSuccess ? 'border-[#4C7253]/35' : 'border-[#C27D6B]/35'
            }`}
          />

          {/* 墨迹粒子微光散发 */}
          <div className="absolute inset-0 pointer-events-none overflow-visible flex items-center justify-center">
            <span
              className="absolute -top-1 -left-2 w-1.5 h-1.5 rounded-full bg-[#7EA885]/60 animate-ink-spread"
              style={{ animationDelay: '220ms' }}
            />
            <span
              className="absolute -bottom-1 -right-2 w-1.5 h-1.5 rounded-full bg-[#7EA885]/60 animate-ink-spread"
              style={{ animationDelay: '240ms' }}
            />
            <span
              className="absolute top-0 right-1 w-1 h-1 rounded-full bg-[#C27D6B]/40 animate-ink-spread"
              style={{ animationDelay: '200ms' }}
            />
          </div>

          {/* 印章主体：微凹凸材质（Emboss）与墨迹深浅手造质感 */}
          {isSuccess && (
            <div
              onClick={triggerAnimation}
              cursor-pointer="true"
              className="animate-stamp-drop-green vintage-stamp-green px-4 py-1.5 text-xl font-bold tracking-wide shadow-md cursor-pointer select-none relative group"
              title="点击可重新盖章体验"
            >
              {/* 印章内侧细腻双重框线 */}
              <div className="absolute inset-0.5 border border-dashed border-[#4C7253]/30 rounded-[5px] pointer-events-none" />
              <Award className="w-5 h-5 mr-1 text-[#3B5D41] shrink-0" />
              <div className="flex flex-col items-start leading-tight">
                <span className="text-xl">APPROVED · 签到成功</span>
                <span className="text-[9px] tracking-widest uppercase font-mono opacity-70 -mt-0.5">
                  OFFICIAL VERIFIED
                </span>
              </div>
            </div>
          )}

          {isRepeated && (
            <div
              onClick={triggerAnimation}
              className="animate-stamp-drop-red vintage-stamp px-4 py-1.5 text-xl font-bold tracking-wide shadow-md cursor-pointer select-none relative group"
              title="点击可重新盖章体验"
            >
              <div className="absolute inset-0.5 border border-dashed border-[#B25A45]/30 rounded-[5px] pointer-events-none" />
              <Clock className="w-5 h-5 mr-1 text-[#B25A45] shrink-0" />
              <div className="flex flex-col items-start leading-tight">
                <span className="text-xl">COOLDOWN · 已签到</span>
                <span className="text-[9px] tracking-widest uppercase font-mono opacity-70 -mt-0.5">
                  DUPLICATE SUPPRESSED
                </span>
              </div>
            </div>
          )}

          {isFail && (
            <div
              onClick={triggerAnimation}
              className="animate-stamp-drop-red vintage-stamp px-4 py-1.5 text-xl font-bold tracking-wide shadow-md cursor-pointer select-none relative group"
              title="点击可重新盖章体验"
            >
              <div className="absolute inset-0.5 border border-dashed border-[#C27D6B]/30 rounded-[5px] pointer-events-none" />
              <AlertCircle className="w-5 h-5 mr-1 text-[#C27D6B] shrink-0" />
              <div className="flex flex-col items-start leading-tight">
                <span className="text-xl">UNMATCHED · 未通过</span>
                <span className="text-[9px] tracking-widest uppercase font-mono opacity-70 -mt-0.5">
                  NO MATCH FOUND
                </span>
              </div>
            </div>
          )}
        </div>

        {/* 标题与描述 */}
        <div className="space-y-1">
          <h2 className="text-2xl font-bold font-gaegu text-[#4A453B]">
            {isSuccess ? '打卡记录已生成！' : isRepeated ? '请勿重复刷脸' : '未匹配到底库人员'}
          </h2>
          <p className="text-xs text-[#8E8675] max-w-xs leading-relaxed">{result.message}</p>
        </div>

        {/* 第二阶段：拍立得卡片出片/展开 (Card Reveal: Slide & Scale + Ambient Shadow + Sheen Sweep) */}
        {result.user && (
          <div className="w-full relative animate-polaroid-reveal">
            {/* 拍立得主卡体 */}
            <div className="polaroid-card rounded-xl text-left space-y-2 border border-[#E3DCD1] relative overflow-hidden bg-white">
              {/* 点睛动效：低对比度斜向微光扫过 (Shimmer / Sheen Sweep) */}
              <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-xl z-20">
                <div className="w-2/3 h-full bg-gradient-to-r from-transparent via-white/45 to-transparent animate-sheen-sweep" />
              </div>

              {/* 右上角点睛金色徽标 (Spring 弹性弹出) */}
              <div className="absolute top-2.5 right-2.5 z-30 animate-gold-badge pointer-events-none select-none">
                <div className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-gradient-to-r from-[#FFF8EE] to-[#F7EDD9] border border-[#DFCBA8] text-[#8C6D37] text-[11px] font-gaegu font-bold shadow-xs">
                  <Sparkles className="w-3 h-3 text-[#D4AF37]" />
                  <span>
                    {result.similarity !== undefined && result.similarity > 0.85
                      ? '极速高精匹配'
                      : '已验真入册'}
                  </span>
                </div>
              </div>

              {/* 人员头像与身份概要 */}
              <div className="flex items-center space-x-3 pb-2 border-b border-[#EEE8DE] relative z-10">
                <div className="relative shrink-0">
                  <img
                    src={result.user.avatarUrl}
                    alt={result.user.name}
                    className="w-12 h-12 rounded-lg object-cover border border-[#D6CEC1] shadow-2xs"
                  />
                  {isSuccess && (
                    <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-[#7EA885] text-white rounded-full flex items-center justify-center shadow-xs">
                      <Check className="w-2.5 h-2.5 stroke-[3]" />
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1 pr-14">
                  <div className="flex items-center space-x-2">
                    <span className="text-xl font-bold font-gaegu text-[#4A453B] truncate">
                      {result.user.name}
                    </span>
                  </div>
                  <div className="mono text-xs text-[#8E8675] truncate">{result.user.studentId}</div>
                </div>
              </div>

              {/* 部门与时间详情 */}
              <div className="grid grid-cols-2 gap-2 text-xs text-[#5C5648] pt-1 relative z-10">
                <div className="flex items-center space-x-1.5 truncate">
                  <Building2 className="w-3.5 h-3.5 text-[#8E8675] shrink-0" />
                  <span className="truncate">{result.user.department}</span>
                </div>
                <div className="flex items-center space-x-1.5 truncate">
                  <Clock className="w-3.5 h-3.5 text-[#8E8675] shrink-0" />
                  <span className="mono text-[#8E8675]">{result.checkinTime || '刚刚'}</span>
                </div>
              </div>

              {/* 底部相似度评分栏 */}
              {result.similarity !== undefined && (
                <div className="pt-1.5 border-t border-[#F2EDE4] flex items-center justify-between text-[11px] text-[#8E8675]">
                  <span>人脸置信度指标</span>
                  <span className="font-mono font-bold text-[#4C7253]">
                    {(result.similarity * 100).toFixed(1)}%
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 飞书妙搭同步邮戳条 */}
        {(isSuccess || isRepeated) && (
          <div
            id="feishu-sync-indicator"
            className={`w-full p-2.5 rounded-xl border text-xs flex items-center justify-between font-gaegu text-base ${
              result.feishuSynced
                ? 'bg-[rgba(126,168,133,0.15)] border-[#7EA885]/60 text-[#4C7253]'
                : isRepeated
                ? 'bg-[#EEE8DE] border-[#D6CEC1] text-[#8E8675]'
                : 'bg-[rgba(229,169,155,0.15)] border-[#E5A99B] text-[#B25A45]'
            }`}
          >
            <div className="flex items-center space-x-2">
              <Send className="w-4 h-4 shrink-0" />
              <span className="text-left font-semibold">
                {isRepeated
                  ? '防重复机制：冷却期内不重复推送飞书'
                  : result.feishuSynced
                  ? '已同步推送到飞书妙搭数据表'
                  : result.feishuMsg || '飞书未配置或暂未推送'}
              </span>
            </div>
            {result.feishuSynced && (
              <span className="vintage-stamp-green text-xs px-1.5 py-0.5 shrink-0">
                已入库
              </span>
            )}
          </div>
        )}

        {/* 底部确认操作按钮与手账自动收起进度条 */}
        <div className="w-full space-y-2 pt-1">
          <button
            id="confirm-modal-done-btn"
            type="button"
            onClick={onClose}
            className="stamp-button stamp-button-primary w-full py-2.5 rounded-xl text-xl font-bold flex items-center justify-center space-x-1.5 shadow-sm active:translate-y-0.5"
          >
            <span>完成 · 继续下一位 ({countdown}s)</span>
            <ArrowRight className="w-4 h-4" />
          </button>

          {/* 自动关闭倒计时手账虚线进度条 */}
          {(isSuccess || isRepeated) && (
            <div className="w-full bg-[#EADFD0]/40 h-1 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#A89E90] transition-all duration-1000 ease-linear rounded-full"
                style={{ width: `${(countdown / 5) * 100}%` }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
