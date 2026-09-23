import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  AlertCircle,
  Clock,
  Send,
  X,
  Building2,
  ArrowRight,
  Stamp,
  Award
} from 'lucide-react';
import { CheckinResultState } from '../types';

interface CheckinResultModalProps {
  result: CheckinResultState | null;
  onClose: () => void;
}

export const CheckinResultModal: React.FC<CheckinResultModalProps> = ({ result, onClose }) => {
  const [countdown, setCountdown] = useState<number>(5);

  useEffect(() => {
    if (!result || (result.status !== 'success' && result.status !== 'repeated')) return;
    setCountdown(5);

    const timer = setInterval(() => {
      setCountdown(prev => Math.max(0, prev - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [result]);

  // 当倒计时归零时，通过独立副作用安全触发 onClose
  useEffect(() => {
    if (countdown === 0 && result && (result.status === 'success' || result.status === 'repeated')) {
      onClose();
    }
  }, [countdown, result, onClose]);

  if (!result || result.status === 'idle' || result.status === 'scanning') return null;

  const isSuccess = result.status === 'success';
  const isRepeated = result.status === 'repeated';
  const isFail = result.status === 'not_found' || result.status === 'error';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#4A453B]/50 backdrop-blur-xs animate-in fade-in duration-200">
      <div
        id="checkin-result-card"
        className="card w-full max-w-sm p-6 relative overflow-visible text-[#5C5648] flex flex-col items-center text-center space-y-4 shadow-2xl"
      >
        {/* 和纸胶带装饰 (Washi Tape) */}
        <div
          className="washi-tape"
          style={{ top: '-11px', left: '50%', transform: 'translateX(-50%) rotate(-1deg)', width: '90px' }}
        />

        {/* 顶部关闭按钮 */}
        <button
          id="close-result-modal-btn"
          onClick={onClose}
          className="absolute top-3.5 right-3.5 p-1.5 text-[#8E8675] hover:text-[#4A453B] rounded-full hover:bg-[#EEE8DE] transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {/* 复古印章 (Vintage Stamp Badge) */}
        <div className="pt-2">
          {isSuccess && (
            <div className="vintage-stamp-green px-4 py-1.5 text-xl font-bold tracking-wide shadow-xs">
              <Award className="w-5 h-5 mr-1 text-[#4C7253]" />
              <span>APPROVED · 签到成功</span>
            </div>
          )}
          {isRepeated && (
            <div className="vintage-stamp px-4 py-1.5 text-xl font-bold tracking-wide shadow-xs">
              <Clock className="w-5 h-5 mr-1 text-[#B25A45]" />
              <span>COOLDOWN · 已签到</span>
            </div>
          )}
          {isFail && (
            <div className="vintage-stamp px-4 py-1.5 text-xl font-bold tracking-wide shadow-xs">
              <AlertCircle className="w-5 h-5 mr-1 text-[#C27D6B]" />
              <span>UNMATCHED · 未通过</span>
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

        {/* 拍立得风格的人员信息卡 */}
        {result.user && (
          <div className="w-full polaroid-card rounded-xl text-left space-y-2 border border-[#E3DCD1]">
            <div className="flex items-center space-x-3 pb-2 border-b border-[#EEE8DE]">
              <img
                src={result.user.avatarUrl}
                alt={result.user.name}
                className="w-12 h-12 rounded-lg object-cover border border-[#D6CEC1] shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <span className="text-lg font-bold font-gaegu text-[#4A453B] truncate">
                    {result.user.name}
                  </span>
                  {result.similarity !== undefined && (
                    <span className="font-gaegu text-sm text-[#4C7253] border border-[#7EA885] bg-[rgba(126,168,133,0.15)] px-2 py-0.5 rounded-full shrink-0">
                      相似度 {(result.similarity * 100).toFixed(1)}%
                    </span>
                  )}
                </div>
                <div className="mono text-[#8E8675] truncate">{result.user.studentId}</div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-1 text-xs text-[#5C5648] pt-1">
              <div className="flex items-center space-x-2">
                <Building2 className="w-3.5 h-3.5 text-[#8E8675] shrink-0" />
                <span className="truncate">{result.user.department}</span>
              </div>
              <div className="flex items-center space-x-2">
                <Clock className="w-3.5 h-3.5 text-[#8E8675] shrink-0" />
                <span className="mono text-[#8E8675]">{result.checkinTime || '刚刚'}</span>
              </div>
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

        {/* 底部确认操作按钮 (Stamp button) */}
        <button
          id="confirm-modal-done-btn"
          type="button"
          onClick={onClose}
          className="stamp-button stamp-button-primary w-full py-2.5 rounded-xl text-xl font-bold flex items-center justify-center space-x-1.5"
        >
          <span>确认知道了 ({countdown}s)</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
