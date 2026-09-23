/**
 * 极速连续排队打卡多感官反馈工具包：
 * 1. Web Audio API 原生无延迟音频合成（成功叮声、冷却轻音、异常微音）
 * 2. 移动端震动触觉（Haptic Vibration）
 * 3. 屏幕常亮唤醒锁（Screen Wake Lock API，防止展台/考勤机自动锁屏）
 */

// 缓存 AudioContext 单例
let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

/**
 * 成功打卡：清脆悦耳的晶莹双音（“叮~咚” / 880Hz -> 1318.5Hz）
 */
export function playSuccessChime(isMuted: boolean = false) {
  if (isMuted) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    // 第一音符：A5 (880Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(880, now);
    gain1.gain.setValueAtTime(0.18, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.15);

    // 第二音符：E6 (1318.5Hz) 稍后延迟 70ms 触发，形成灵动的叮咚和弦
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1318.5, now + 0.07);
    gain2.gain.setValueAtTime(0.001, now);
    gain2.gain.setValueAtTime(0.22, now + 0.07);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.07);
    osc2.stop(now + 0.29);
  } catch (e) {
    // 忽略音频受阻
  }
}

/**
 * 重复打卡 / 冷却期提示：温和双顿音（523Hz -> 440Hz）
 */
export function playDuplicateNotice(isMuted: boolean = false) {
  if (isMuted) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(523.25, now);
    osc.frequency.setValueAtTime(440, now + 0.08);

    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.22);
  } catch (e) {}
}

/**
 * 未匹配 / 异常提示音：柔和低频两声
 */
export function playUnmatchedNotice(isMuted: boolean = false) {
  if (isMuted) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(329.63, now);
    osc.frequency.setValueAtTime(261.63, now + 0.09);

    gain.gain.setValueAtTime(0.16, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.24);
  } catch (e) {}
}

/**
 * 快门声
 */
export function playShutterSound(isMuted: boolean = false) {
  if (isMuted) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1200, now);
    osc.frequency.exponentialRampToValueAtTime(100, now + 0.05);
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.06);
  } catch (e) {}
}

/**
 * 触觉震动反馈
 */
export function triggerHaptic(type: 'success' | 'warning' | 'error') {
  if (typeof navigator === 'undefined' || !navigator.vibrate) return;
  try {
    if (type === 'success') {
      navigator.vibrate([35, 25, 45]);
    } else if (type === 'warning') {
      navigator.vibrate([50]);
    } else if (type === 'error') {
      navigator.vibrate([80, 40, 80]);
    }
  } catch (e) {}
}

/**
 * 屏幕常亮唤醒锁管理（Screen Wake Lock API）
 */
let wakeLockSentinel: any = null;

export async function requestScreenWakeLock(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return false;
  try {
    wakeLockSentinel = await (navigator as any).wakeLock.request('screen');
    wakeLockSentinel.addEventListener('release', () => {
      wakeLockSentinel = null;
    });
    return true;
  } catch (e) {
    return false;
  }
}

export async function releaseScreenWakeLock(): Promise<void> {
  if (wakeLockSentinel) {
    try {
      await wakeLockSentinel.release();
    } catch (e) {}
    wakeLockSentinel = null;
  }
}
