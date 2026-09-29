import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Smartphone,
  Settings,
  Sparkles,
  ShieldCheck,
  Send,
  Users,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Clock,
  FlipHorizontal,
  ArrowLeft,
  KeyRound,
  LogOut,
  X,
  Lock
} from 'lucide-react';
import { CameraView } from './components/CameraView';
import { CheckinResultModal } from './components/CheckinResultModal';
import { AdminPanel } from './components/AdminPanel';
import { AdminLoginView } from './components/AdminLoginView';
import { HttpsGuideModal } from './components/HttpsGuideModal';
import { PersonRecord, CheckinLog, FeishuConfigState, CheckinResultState, FastPassFeedback } from './types';
import {
  getApiUrl,
  authFetch,
  getAdminToken,
  setAdminToken,
  clearAdminAuth,
  isTokenValid,
  parseJwtPayload
} from './utils/api';
import {
  DEFAULT_FEISHU_CONFIG,
  checkDuplicateCheckin
} from './utils/faceMatcher';
import {
  playSuccessChime,
  playDuplicateNotice,
  playUnmatchedNotice,
  triggerHaptic,
  requestScreenWakeLock,
  releaseScreenWakeLock
} from './utils/feedback';

export default function App() {
  // 路由状态：检测是否访问 /admin
  const [isAdminRoute, setIsAdminRoute] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const p = window.location.pathname;
    const h = window.location.hash;
    return p === '/admin' || p.startsWith('/admin/') || h === '#admin';
  });

  // 管理员账号（从 JWT Token 动态解析或通过 /api/auth/me 获知）
  const [adminUsername, setAdminUsername] = useState<string>(() => {
    const token = getAdminToken();
    const payload = parseJwtPayload(token);
    return payload?.sub || 'admin';
  });

  // 管理员登录认证态（严格校验 JWT 存在性与有效截至时间 exp，杜绝 session 残留假登录）
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const token = getAdminToken();
    return isTokenValid(token);
  });

  // 修改密码弹窗状态
  const [isChangePwdOpen, setIsChangePwdOpen] = useState<boolean>(false);
  const [oldPasswordInput, setOldPasswordInput] = useState<string>('');
  const [newPasswordInput, setNewPasswordInput] = useState<string>('');
  const [confirmPasswordInput, setConfirmPasswordInput] = useState<string>('');
  const [isSubmittingPwd, setIsSubmittingPwd] = useState<boolean>(false);
  const [changePwdMsg, setChangePwdMsg] = useState<{ text: string; isError: boolean }>({ text: '', isError: false });

  // 路由跳转辅助
  const navigateTo = useCallback((path: string) => {
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', path);
      const isAdm = path === '/admin' || path.startsWith('/admin/') || window.location.hash === '#admin';
      setIsAdminRoute(isAdm);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, []);

  // 监听浏览器前进/后退/hash变化
  useEffect(() => {
    const handleLocationChange = () => {
      const p = window.location.pathname;
      const h = window.location.hash;
      setIsAdminRoute(p === '/admin' || p.startsWith('/admin/') || h === '#admin');
    };

    window.addEventListener('popstate', handleLocationChange);
    window.addEventListener('hashchange', handleLocationChange);
    return () => {
      window.removeEventListener('popstate', handleLocationChange);
      window.removeEventListener('hashchange', handleLocationChange);
    };
  }, []);

  // 全局监听 401 Unauthorized 事件（Token 过期或失效，自动清退并回退至登录页）
  useEffect(() => {
    const handleUnauthorized = (e: any) => {
      setIsAdminAuthenticated(false);
      clearAdminAuth();
      const msg = e.detail?.message || '管理员登录凭证已过期或无效，请重新登录';
      alert(msg);
    };

    window.addEventListener('face_checkin_unauthorized', handleUnauthorized);
    return () => {
      window.removeEventListener('face_checkin_unauthorized', handleUnauthorized);
    };
  }, []);

  // 管理员认证处理
  const handleAdminLoginSuccess = () => {
    setIsAdminAuthenticated(true);
    const token = getAdminToken();
    const payload = parseJwtPayload(token);
    if (payload?.sub) {
      setAdminUsername(payload.sub);
    }
  };

  const handleAdminLogout = () => {
    clearAdminAuth();
    setIsAdminAuthenticated(false);
  };

  // 修改密码保存：调用后端真实 /api/auth/change-password 并更新 SQLite
  const handleSaveNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setChangePwdMsg({ text: '', isError: false });

    if (!oldPasswordInput) {
      setChangePwdMsg({ text: '请输入原密码', isError: true });
      return;
    }
    if (!newPasswordInput || newPasswordInput.length < 4) {
      setChangePwdMsg({ text: '新密码长度至少需要4位', isError: true });
      return;
    }
    if (newPasswordInput !== confirmPasswordInput) {
      setChangePwdMsg({ text: '两次输入的新密码不一致', isError: true });
      return;
    }

    setIsSubmittingPwd(true);
    try {
      const res = await authFetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          old_password: oldPasswordInput,
          new_password: newPasswordInput
        })
      });

      if (res.ok) {
        const data = await res.json();
        setChangePwdMsg({ text: data.message || '密码修改成功，已同步至后端数据库！', isError: false });
        setIsDefaultPassword(false);

        setTimeout(() => {
          setIsChangePwdOpen(false);
          setOldPasswordInput('');
          setNewPasswordInput('');
          setConfirmPasswordInput('');
          setChangePwdMsg({ text: '', isError: false });
        }, 1200);
      } else {
        const data = await res.json().catch(() => ({}));
        setChangePwdMsg({ text: data.detail || `修改密码失败 (HTTP ${res.status})`, isError: true });
      }
    } catch (err: any) {
      setChangePwdMsg({ text: `网络连接异常: ${err.message || '无法连接到后端数据库'}`, isError: true });
    } finally {
      setIsSubmittingPwd(false);
    }
  };

  // 底库人员数据（后端 SQLite 为唯一事实源，彻底杜绝本地伪持久化与离线数据分裂）
  const [persons, setPersons] = useState<PersonRecord[]>([]);

  // 飞书配置（后端 SQLite 为唯一事实源，严格排除在 localStorage 明文持久化敏感 Secret）
  const [feishuConfig, setFeishuConfig] = useState<FeishuConfigState>(DEFAULT_FEISHU_CONFIG);
  const [isDefaultPassword, setIsDefaultPassword] = useState<boolean>(false);

  // 启动清理历史版本残留于浏览器的旧明文凭据（防止 DevTools 或扩展读取已泄露的凭据）
  useEffect(() => {
    try {
      localStorage.removeItem('face_checkin_feishu');
      localStorage.removeItem('face_checkin_admin_creds');
    } catch (e) {
      // ignore
    }
  }, []);

  // 签到流水日志
  const [logs, setLogs] = useState<CheckinLog[]>(() => {
    const saved = localStorage.getItem('face_checkin_logs');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        return [];
      }
    }
    return [];
  });

  // 打卡状态
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [statusText, setStatusText] = useState<string>('请将面部对准参考框');
  const [hasError, setHasError] = useState<boolean>(false);
  const [checkinResult, setCheckinResult] = useState<CheckinResultState | null>(null);

  // 连续极速打卡排队模式状态
  const [isFastPassMode, setIsFastPassMode] = useState<boolean>(() => {
    return localStorage.getItem('face_checkin_fast_pass') === 'true';
  });
  const [fastPassFeedback, setFastPassFeedback] = useState<FastPassFeedback | null>(null);
  const [fastPassCount, setFastPassCount] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(() => {
    return localStorage.getItem('face_checkin_muted') === 'true';
  });
  const [isWakeLockActive, setIsWakeLockActive] = useState<boolean>(false);
  const fastPassResetTimerRef = useRef<number | null>(null);

  // HTTPS 真机说明弹窗
  const [isHttpsGuideOpen, setIsHttpsGuideOpen] = useState<boolean>(false);

  // 持久化同步（仅同步前端极速模式与静音偏好，飞书配置与人员底库由服务端安全统一托管）
  useEffect(() => {
    localStorage.setItem('face_checkin_logs', JSON.stringify(logs));
  }, [logs]);

  useEffect(() => {
    localStorage.setItem('face_checkin_fast_pass', String(isFastPassMode));
  }, [isFastPassMode]);

  useEffect(() => {
    localStorage.setItem('face_checkin_muted', String(isMuted));
  }, [isMuted]);

  // 屏幕常亮机制（Screen Wake Lock API，防止排队期间手机锁屏）
  useEffect(() => {
    let isCancelled = false;
    if (isFastPassMode) {
      requestScreenWakeLock().then(active => {
        if (!isCancelled) setIsWakeLockActive(active);
      });
    } else {
      releaseScreenWakeLock();
      setIsWakeLockActive(false);
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isFastPassMode) {
        requestScreenWakeLock().then(active => {
          if (!isCancelled) setIsWakeLockActive(active);
        });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      isCancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      releaseScreenWakeLock();
    };
  }, [isFastPassMode]);

  // 初始化尝试从后端 SQLite 底库同步人员列表与飞书配置
  useEffect(() => {
    const fetchBackendInitialData = async () => {
      try {
        const token = getAdminToken();
        const valid = isTokenValid(token);

        // 1. 获取后端人员底库（以服务器 SQLite 为唯一事实源）
        const usersRes = await fetch(getApiUrl('/api/users'));
        if (usersRes.ok) {
          const backendUsers = await usersRes.json();
          if (Array.isArray(backendUsers)) {
            const mappedPersons: PersonRecord[] = backendUsers.map((u: any) => ({
              id: String(u.id),
              name: u.name,
              studentId: u.student_id,
              department: u.department,
              avatarUrl: u.avatar_url ? getApiUrl(u.avatar_url) : '/images/demo-zhang.jpg',
              embedding: [],
              createdAt: u.created_at || ''
            }));
            setPersons(mappedPersons);
          }
        }

        // 2. 若存在有效管理员 Token，拉取配置、流水与管理员信息
        if (token && valid) {
          // 获取当前管理员信息及密码弱口令状态
          authFetch('/api/auth/me').then(async meRes => {
            if (meRes.ok) {
              const meData = await meRes.json();
              if (meData.username) setAdminUsername(meData.username);
              if (meData.is_default_password !== undefined) {
                setIsDefaultPassword(Boolean(meData.is_default_password));
              }
            }
          }).catch(() => {});

          const cfgRes = await authFetch('/api/config/feishu');
          if (cfgRes.ok) {
            const cfg = await cfgRes.json();
            setFeishuConfig({
              mode: cfg.mode || 'webhook',
              enabled: cfg.enabled ?? true,
              webhookUrl: cfg.webhook_url || '',
              appId: cfg.app_id || '',
              appSecret: '', // 前端不保留明文密钥
              hasAppSecret: Boolean(cfg.has_app_secret),
              appSecretMasked: cfg.app_secret_masked || '',
              appToken: cfg.app_token || '',
              tableId: cfg.table_id || ''
            });
          }

          const logsRes = await authFetch('/api/logs?limit=50');
          if (logsRes.ok) {
            const backendLogs = await logsRes.json();
            if (Array.isArray(backendLogs)) {
              setLogs(backendLogs.map((l: any) => ({
                id: String(l.id),
                userId: String(l.user_id),
                name: l.name,
                studentId: l.student_id,
                department: l.department,
                similarity: l.similarity,
                checkinTime: l.checkin_time,
                feishuStatus: l.feishu_status,
                errorMsg: l.error_msg,
                retryCount: l.retry_count,
                feishuRecordId: l.feishu_record_id
              })));
            }
          }
        } else if (token && !valid) {
          // Token 已过期，主动清理
          clearAdminAuth();
          setIsAdminAuthenticated(false);
        }
      } catch (e) {
        // 后端无法连接时保持空状态，杜绝离线伪造底库
      }
    };

    fetchBackendInitialData();
  }, []);

  // 人员新增：严格以后端数据库与 InsightFace 特征提取为唯一事实源，彻底杜绝虚假成功与离线数据分裂
  const handleAddPerson = async (newPerson: PersonRecord, photoBase64?: string): Promise<{ success: boolean; message?: string }> => {
    const token = getAdminToken();
    if (!token || !isTokenValid(token)) {
      clearAdminAuth();
      setIsAdminAuthenticated(false);
      return {
        success: false,
        message: '管理员登录凭证已过期或无效，请重新登录管理后台'
      };
    }
    if (!photoBase64) {
      return {
        success: false,
        message: '请上传或拍摄正脸照后再提交录入'
      };
    }

    try {
      const res = await authFetch('/api/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: newPerson.name,
          student_id: newPerson.studentId,
          department: newPerson.department,
          photo_base64: photoBase64
        })
      });

      if (res.ok) {
        const data = await res.json();
        const savedPerson: PersonRecord = {
          id: String(data.id),
          name: data.name,
          studentId: data.student_id,
          department: data.department,
          avatarUrl: data.avatar_url ? getApiUrl(data.avatar_url) : newPerson.avatarUrl,
          embedding: [],
          createdAt: data.created_at
        };
        setPersons(prev => [savedPerson, ...prev]);
        return { success: true };
      } else {
        const errData = await res.json().catch(() => ({}));
        if (res.status === 401) {
          setIsAdminAuthenticated(false);
          return {
            success: false,
            message: '管理员登录凭证已过期，请重新登录'
          };
        }
        return {
          success: false,
          message: errData.detail || `后端人脸特征提取/录入未通过 (HTTP ${res.status})，请确认照片正脸清晰且未遮挡`
        };
      }
    } catch (err: any) {
      console.error('后端录入接口调用失败:', err);
      return {
        success: false,
        message: `无法连接后端服务 (${err.message || '网络中断'})。考勤刷脸必须依赖后端人脸特征库，已阻止离线虚假录入。`
      };
    }
  };

  // 人员删除：检查后端响应状态，确认成功后再同步更新 UI
  const handleDeletePerson = async (id: string): Promise<{ success: boolean; message?: string }> => {
    const token = getAdminToken();
    if (!token || !isTokenValid(token)) {
      clearAdminAuth();
      setIsAdminAuthenticated(false);
      const msg = '管理员登录凭证已过期，请重新登录管理后台';
      alert(msg);
      return { success: false, message: msg };
    }

    try {
      const res = await authFetch(`/api/users/${id}`, {
        method: 'DELETE'
      });

      if (res.ok) {
        setPersons(prev => prev.filter(p => p.id !== id));
        return { success: true };
      } else {
        const errData = await res.json().catch(() => ({}));
        if (res.status === 401) {
          setIsAdminAuthenticated(false);
        }
        const msg = errData.detail || (res.status === 401 ? '管理员凭证已过期，请重新登录' : `删除人员失败 (HTTP ${res.status})`);
        alert(msg);
        return { success: false, message: msg };
      }
    } catch (e: any) {
      console.error('后端删除接口调用失败:', e);
      const msg = `网络连接异常，删除未能同步到后端: ${e.message || '请检查后端服务'}`;
      alert(msg);
      return { success: false, message: msg };
    }
  };

  // 飞书配置保存：以服务端确认为准，敏感 App Secret 只写隔离
  const handleUpdateFeishuConfig = async (config: FeishuConfigState): Promise<{ success: boolean; message?: string }> => {
    const token = getAdminToken();
    if (!token || !isTokenValid(token)) {
      clearAdminAuth();
      setIsAdminAuthenticated(false);
      return { success: false, message: '管理员登录凭证已过期，请先登录后台后再保存配置' };
    }

    try {
      const payload: any = {
        mode: config.mode,
        enabled: config.enabled,
        webhook_url: config.webhookUrl,
        app_id: config.appId,
        app_token: config.appToken,
        table_id: config.tableId
      };
      // 仅在管理员明确输入了新密钥时才提交，留空或脱敏符号保持服务端现有密钥
      if (config.appSecret && config.appSecret.trim() && config.appSecret !== '************') {
        payload.app_secret = config.appSecret.trim();
      }

      const res = await authFetch('/api/config/feishu', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        setFeishuConfig({
          ...config,
          appSecret: '', // 清空前端状态中的明文输入
          hasAppSecret: Boolean(config.hasAppSecret || payload.app_secret)
        });
        const nowStr = new Date().toLocaleString();
        localStorage.setItem('face_checkin_feishu_saved_at', nowStr);
        return { success: true, message: '飞书配置已成功保存！密钥已加密隔离在服务端。' };
      } else {
        const errData = await res.json().catch(() => ({}));
        if (res.status === 401) {
          setIsAdminAuthenticated(false);
        }
        const msg = errData.detail || (res.status === 401 ? '管理员凭证已过期，请重新登录' : `保存失败 (HTTP ${res.status})`);
        return { success: false, message: msg };
      }
    } catch (e: any) {
      console.error('后端飞书配置同步失败:', e);
      return { success: false, message: `网络异常或后端服务未就绪: ${e.message || '请检查后端服务'}` };
    }
  };

  // 刷新流水日志
  const refreshLogs = useCallback(async () => {
    try {
      const logsRes = await authFetch('/api/logs?limit=100');
      if (logsRes.ok) {
        const backendLogs = await logsRes.json();
        if (Array.isArray(backendLogs)) {
          setLogs(backendLogs.map((l: any) => ({
            id: String(l.id),
            userId: String(l.user_id),
            name: l.name,
            studentId: l.student_id,
            department: l.department,
            similarity: l.similarity,
            checkinTime: l.checkin_time,
            feishuStatus: l.feishu_status,
            errorMsg: l.error_msg,
            retryCount: l.retry_count,
            feishuRecordId: l.feishu_record_id
          })));
        }
      }
    } catch (e) {
      console.warn('刷新签到流水失败:', e);
    }
  }, []);

  // 重试单条失败流水
  const handleRetrySingleLog = async (logId: string): Promise<{ success: boolean; message?: string }> => {
    try {
      const res = await authFetch(`/api/logs/${logId}/retry`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      await refreshLogs();
      if (res.ok && data.success) {
        return { success: true, message: data.message || '重试同步成功' };
      } else {
        return { success: false, message: data.message || data.detail || '重试同步失败' };
      }
    } catch (e: any) {
      await refreshLogs();
      return { success: false, message: e.message || '重试网络请求异常' };
    }
  };

  // 一键重试全部失败流水
  const handleRetryAllFailedLogs = async (): Promise<{ success: boolean; message?: string }> => {
    try {
      const res = await authFetch('/api/logs/retry-all', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      await refreshLogs();
      if (res.ok) {
        return { success: true, message: data.message || `补录完成：成功 ${data.succeeded} 条，失败 ${data.failed} 条` };
      } else {
        return { success: false, message: data.detail || '一键重试失败' };
      }
    } catch (e: any) {
      await refreshLogs();
      return { success: false, message: e.message || '一键重试请求网络异常' };
    }
  };

  // 清空签到流水日志：严格等待后端确认后清空
  const handleClearLogs = async (): Promise<{ success: boolean; message?: string }> => {
    const token = getAdminToken();
    if (!token || !isTokenValid(token)) {
      clearAdminAuth();
      setIsAdminAuthenticated(false);
      const msg = '管理员登录凭证已过期，请重新登录后台';
      alert(msg);
      return { success: false, message: msg };
    }

    try {
      const res = await authFetch('/api/logs', {
        method: 'DELETE'
      });

      if (res.ok) {
        setLogs([]);
        localStorage.removeItem('face_checkin_logs');
        return { success: true };
      } else {
        const errData = await res.json().catch(() => ({}));
        if (res.status === 401) {
          setIsAdminAuthenticated(false);
        }
        const msg = errData.detail || (res.status === 401 ? '管理员凭证已过期，请重新登录' : `清空失败 (HTTP ${res.status})`);
        alert(msg);
        return { success: false, message: msg };
      }
    } catch (e: any) {
      console.error('清空日志接口调用失败:', e);
      const msg = `网络异常或后端服务未连接: ${e.message || '请检查后端服务'}`;
      alert(msg);
      return { success: false, message: msg };
    }
  };

  // 处理截帧识别打卡：严格以后端 InsightFace 识别为唯一源，杜绝前端本地模糊匹配降级
  const handleCaptureFrame = useCallback(
    async (frameBase64: string, _imageData: ImageData) => {
      if (isProcessing) return;
      setIsProcessing(true);
      setHasError(false);
      setStatusText('正在提取 512 维人脸特征并比对...');

      try {
        let matchedPerson: PersonRecord | null = null;
        let similarity = 0;
        let isRepeated = false;
        let lastTimeStr = '';
        let feishuSynced = false;
        let feishuMessage = '';

        try {
          const res = await fetch(getApiUrl('/api/checkin'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              image_base64: frameBase64,
              threshold: 0.60
            })
          });

          if (res.ok) {
            const data = await res.json();
            if (data.code === 200) {
              matchedPerson = persons.find(p => p.studentId === data.user?.student_id) || {
                id: String(data.user?.id),
                name: data.user?.name,
                studentId: data.user?.student_id,
                department: data.user?.department,
                avatarUrl: frameBase64,
                embedding: [],
                createdAt: data.checkin_time
              };
              similarity = data.similarity;
              feishuSynced = Boolean(data.feishu_synced);
              feishuMessage = data.feishu_message || '';
            } else if (data.code === 201) {
              // 重复打卡
              isRepeated = true;
              matchedPerson = persons.find(p => p.studentId === data.user?.student_id) || (data.user ? {
                id: String(data.user.id),
                name: data.user.name,
                studentId: data.user.student_id,
                department: data.user.department,
                avatarUrl: frameBase64,
                embedding: [],
                createdAt: data.checkin_time || ''
              } : null);
              similarity = data.similarity;
              feishuSynced = false;
              feishuMessage = data.feishu_message || '冷却期内，未重复推送飞书';
            } else {
              // 400 或 404：无匹配人员或人脸未检测到
              setStatusText(data.message || '未匹配到人员');
              setHasError(true);
              setCheckinResult({
                status: 'error',
                message: data.message || '未匹配到人员，请联系管理员录入底库照片',
                similarity: data.similarity || 0,
                checkinTime: new Date().toLocaleString(),
                feishuSynced: false
              });
              return;
            }
          } else {
            const errData = await res.json().catch(() => ({}));
            setStatusText(errData.message || errData.detail || '识别比对未通过');
            setHasError(true);
            setCheckinResult({
              status: 'error',
              message: errData.message || errData.detail || '未匹配到人员，请联系管理员在后台录入人脸底库',
              similarity: 0,
              checkinTime: new Date().toLocaleString(),
              feishuSynced: false
            });
            return;
          }
        } catch (apiErr: any) {
          setStatusText('无法连接后端识别服务');
          setHasError(true);
          setCheckinResult({
            status: 'error',
            message: `无法连接考勤后端服务 (${apiErr.message || '网络中断'})。考勤识别必须依赖后端 InsightFace 底座，已杜绝离线虚假比对。`,
            similarity: 0,
            checkinTime: new Date().toLocaleString(),
            feishuSynced: false
          });
          return;
        }

        const nowStr = new Date().toLocaleString();

        if (isRepeated && matchedPerson) {
          // 防重复打卡
          if (isFastPassMode) {
            playDuplicateNotice(isMuted);
            triggerHaptic('warning');
            setStatusText(`已核验：${matchedPerson.name} · 请下一位通行`);
            setFastPassFeedback({
              id: `fp_${Date.now()}`,
              type: 'repeated',
              message: '防重复冷却中，请直接快速入场',
              user: matchedPerson,
              similarity,
              time: nowStr.split(' ')[1] || nowStr
            });
            if (fastPassResetTimerRef.current) clearTimeout(fastPassResetTimerRef.current);
            fastPassResetTimerRef.current = window.setTimeout(() => {
              setFastPassFeedback(null);
              setStatusText('连续极速排队待命中 · 下一位请就位');
            }, 1100);
            return;
          }

          setStatusText('您已签到成功，请勿重复刷脸');
          setCheckinResult({
            status: 'repeated',
            message: `您在 5 分钟内已签到成功（上次时间：${lastTimeStr || '刚刚'}），无需重复打卡。`,
            user: matchedPerson,
            similarity,
            checkinTime: nowStr,
            isRepeated: true,
            feishuSynced: false,
            feishuMsg: '处于防重复冷却期内，未重复推送飞书'
          });
          return;
        }

        if (matchedPerson) {
          // 写入本地展示流水（后端已持久化并在流水中记录）
          const newLog: CheckinLog = {
            id: `log_${Date.now()}`,
            userId: matchedPerson.id,
            name: matchedPerson.name,
            studentId: matchedPerson.studentId,
            department: matchedPerson.department,
            similarity,
            checkinTime: nowStr,
            feishuStatus: feishuSynced ? 'SUCCESS' : 'LOCAL_SAVED'
          };
          setLogs(prev => [newLog, ...prev]);

          // 如果处于连续极速排队模式：触发清脆提示音、微震与无感 HUD，完全不弹阻断式窗口
          if (isFastPassMode) {
            playSuccessChime(isMuted);
            triggerHaptic('success');
            setFastPassCount(prev => prev + 1);
            setStatusText(`✅ 签到成功：${matchedPerson.name} · 请下一位就位`);
            setFastPassFeedback({
              id: `fp_${Date.now()}`,
              type: 'success',
              message: '人脸比对通过，欢迎入场！',
              user: matchedPerson,
              similarity,
              time: nowStr.split(' ')[1] || nowStr,
              feishuSynced
            });
            if (fastPassResetTimerRef.current) clearTimeout(fastPassResetTimerRef.current);
            fastPassResetTimerRef.current = window.setTimeout(() => {
              setFastPassFeedback(null);
              setStatusText('连续极速排队待命中 · 下一位请就位');
            }, 1000);
            return;
          }

          // 常规模式：展示包含印章坠落与拍立得大弹窗
          setStatusText(`签到成功：${matchedPerson.name}`);
          setCheckinResult({
            status: 'success',
            message: '人脸比对通过，签到数据已成功同步！',
            user: matchedPerson,
            similarity,
            checkinTime: nowStr,
            isRepeated: false,
            feishuSynced,
            feishuMsg: feishuMessage
          });
        } else {
          // 未匹配到人员
          if (isFastPassMode) {
            playUnmatchedNotice(isMuted);
            triggerHaptic('error');
            setHasError(false);
            setStatusText('未匹配到底库人员 · 自动等待下一位');
            setFastPassFeedback({
              id: `fp_${Date.now()}`,
              type: 'not_found',
              message: '未匹配到底库人员，请至人工登记通道',
              similarity,
              time: nowStr.split(' ')[1] || nowStr
            });
            if (fastPassResetTimerRef.current) clearTimeout(fastPassResetTimerRef.current);
            fastPassResetTimerRef.current = window.setTimeout(() => {
              setFastPassFeedback(null);
              setStatusText('连续极速排队待命中 · 下一位请就位');
            }, 1300);
            return;
          }

          setHasError(true);
          setStatusText('未匹配到人员，请联系管理员录入照片');
          setCheckinResult({
            status: 'not_found',
            message: `当前人脸与底库所有人员相似度最高为 ${(similarity * 100).toFixed(1)}%（低于 60% 阈值），请确认已在管理后台录入底库。`,
            similarity
          });
        }
      } catch (err: any) {
        setHasError(true);
        setStatusText(`识别异常: ${err.message || '请重试'}`);
      } finally {
        setIsProcessing(false);
      }
    },
    [isProcessing, persons, logs, feishuConfig, isFastPassMode, isMuted]
  );

  // 快捷模拟某个底库人员进行签到测试（方便无法开摄像头或没有对应人脸时快速体验）
  const handleSimulateCheckin = (person: PersonRecord) => {
    if (isProcessing) return;
    setIsProcessing(true);
    setStatusText(`正在比对底库特征 [${person.name}]...`);

    setTimeout(() => {
      const nowStr = new Date().toLocaleString();
      const timeOnlyStr = new Date().toLocaleTimeString();
      // 防重检查
      const dup = checkDuplicateCheckin(person.id, logs, 300);
      if (dup.isDuplicate) {
        setIsProcessing(false);

        if (isFastPassMode) {
          playDuplicateNotice(isMuted);
          triggerHaptic('warning');
          setStatusText(`已核验：${person.name}（冷却中）· 请下一位通行`);
          setFastPassFeedback({
            id: `fp_${Date.now()}`,
            type: 'repeated',
            message: '防重复冷却中，请直接快速入场',
            user: person,
            similarity: 0.965,
            time: timeOnlyStr
          });
          if (fastPassResetTimerRef.current) clearTimeout(fastPassResetTimerRef.current);
          fastPassResetTimerRef.current = window.setTimeout(() => {
            setFastPassFeedback(null);
            setStatusText('连续极速排队待命中 · 下一位请就位');
          }, 1100);
          return;
        }

        setCheckinResult({
          status: 'repeated',
          message: `您在 5 分钟内已签到成功（上次时间：${dup.lastTime || '刚刚'}），无需重复打卡。`,
          user: person,
          similarity: 0.965,
          checkinTime: nowStr,
          isRepeated: true,
          feishuSynced: false,
          feishuMsg: '处于防重复冷却期内，未重复推送飞书'
        });
        return;
      }

      // 成功
      const newLog: CheckinLog = {
        id: `log_${Date.now()}`,
        userId: person.id,
        name: person.name,
        studentId: person.studentId,
        department: person.department,
        similarity: 0.965,
        checkinTime: nowStr,
        feishuStatus: feishuConfig.enabled && feishuConfig.webhookUrl ? 'SUCCESS' : 'LOCAL_SAVED'
      };
      setLogs(prev => [newLog, ...prev]);
      setIsProcessing(false);

      if (isFastPassMode) {
        playSuccessChime(isMuted);
        triggerHaptic('success');
        setFastPassCount(c => c + 1);
        setStatusText(`✅ 签到成功：${person.name} · 请下一位就位`);
        setFastPassFeedback({
          id: `fp_${Date.now()}`,
          type: 'success',
          message: '签到成功 · 欢迎入场',
          user: person,
          similarity: 0.965,
          time: timeOnlyStr,
          feishuSynced: feishuConfig.enabled
        });
        if (fastPassResetTimerRef.current) clearTimeout(fastPassResetTimerRef.current);
        fastPassResetTimerRef.current = window.setTimeout(() => {
          setFastPassFeedback(null);
          setStatusText('连续极速排队待命中 · 下一位请就位');
        }, 1000);
        return;
      }

      setCheckinResult({
        status: 'success',
        message: '人脸比对通过，签到数据已成功记录！',
        user: person,
        similarity: 0.965,
        checkinTime: nowStr,
        isRepeated: false,
        feishuSynced: feishuConfig.enabled,
        feishuMsg: feishuConfig.enabled ? '已推送到飞书妙搭' : '飞书未配置'
      });
    }, 400);
  };

  // 关闭弹窗并重置取景引导
  const handleCloseModal = useCallback(() => {
    setCheckinResult(null);
    setStatusText('请将面部对准参考框');
    setHasError(false);
  }, []);

  return (
    <div className="min-h-screen flex flex-col font-sans bg-[#f7f7ef] selection:bg-[#E5A99B]/30 selection:text-[#4A453B]">
      {/* ---------------- 界面 1：刷脸签到主界面 (/) ---------------- */}
      {!isAdminRoute ? (
        <>
          {/* 顶部活页笔记本 Header（完整呈现手账封面插画与标语，不裁切） */}
          <header className="w-full flex flex-col items-center pt-0 px-0 relative bg-[#f7f7ef]">
            <div className="w-full max-w-[480px] mx-auto overflow-hidden">
              <img
                id="notebook-header-banner"
                src="/maolasong-notebook-header-OYYDUDEX-1.png"
                onError={(e) => {
                  const target = e.currentTarget;
                  if (!target.dataset.tried) {
                    target.dataset.tried = 'true';
                    target.src = '/zamaolasong-notebook-header-OYYDUDEX-1.png';
                  }
                }}
                alt="今日露脸签到册"
                width={1500}
                height={480}
                className="w-full h-auto block select-none pointer-events-none drop-shadow-xs"
                referrerPolicy="no-referrer"
              />
            </div>
          </header>

          {/* 刷脸签到主视图（优化移动端响应式留白与层级感，确保取景窗与操作按钮首屏可见） */}
          <main className="flex-1 max-w-4xl w-full mx-auto px-2.5 sm:px-6 pt-1 sm:pt-4 pb-6 sm:pb-12 flex flex-col justify-start">
            <div className="flex flex-col items-center justify-center w-full">
              {/* 顶栏便签提示与状态徽章 */}
              <div className="w-full max-w-[420px] flex items-center justify-between px-1 mb-1.5 sm:mb-3">
                <span className="vintage-stamp-green text-sm px-2.5 py-0.5">
                  底库就绪: {persons.length} 人
                </span>

                <button
                  id="open-guide-btn"
                  onClick={() => setIsHttpsGuideOpen(true)}
                  className="font-gaegu text-base text-[#8E8675] hover:text-[#4A453B] flex items-center space-x-1 underline decoration-dashed"
                >
                  <HelpCircle className="w-4 h-4 text-[#B25A45]" />
                  <span>手机调用提示</span>
                </button>
              </div>

              {/* 核心打卡组件（作为视觉核心主角） */}
              <CameraView
                onCaptureFrame={handleCaptureFrame}
                isProcessing={isProcessing}
                statusText={statusText}
                hasError={hasError}
                isFastPassMode={isFastPassMode}
                onToggleFastPassMode={setIsFastPassMode}
                fastPassFeedback={fastPassFeedback}
                fastPassCount={fastPassCount}
                onResetFastPassCount={() => setFastPassCount(0)}
                isMuted={isMuted}
                onToggleMute={() => setIsMuted(prev => !prev)}
                isWakeLockActive={isWakeLockActive}
                recentFastPassUsers={logs}
                isPaused={Boolean(checkinResult) || isHttpsGuideOpen || isAdminRoute}
              />

              {/* 快速体验拍立得相册卡片区（通过响应式 mt-4 sm:mt-6 与相机组件拉开清晰层级，避免小屏局促） */}
              <div className="w-full max-w-[420px] card p-3.5 sm:p-4.5 space-y-2.5 sm:space-y-3 relative mt-4 sm:mt-6 transition-all">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-gaegu text-lg font-bold text-[#4A453B]">
                    快速体验：点击人员模拟刷脸
                  </span>
                  <span className="mono text-[10px] text-[#8E8675]">免摄像头体验</span>
                </div>

                <div className="grid grid-cols-3 gap-2 sm:gap-3">
                  {persons.slice(0, 3).map(person => (
                    <button
                      key={person.id}
                      onClick={() => handleSimulateCheckin(person)}
                      disabled={isProcessing}
                      className="polaroid-card rounded-lg flex flex-col items-center space-y-1 text-center transition-all cursor-pointer active:scale-95 group p-1.5 sm:p-2"
                      title={`模拟 ${person.name} 刷脸`}
                    >
                      <img
                        src={person.avatarUrl}
                        alt={person.name}
                        className="w-11 h-11 sm:w-12 sm:h-12 rounded object-cover border border-[#D6CEC1] group-hover:border-[#E5A99B]"
                      />
                      <div className="font-gaegu text-base font-bold text-[#4A453B] truncate max-w-full">
                        {person.name}
                      </div>
                      <div className="mono text-[10px] text-[#8E8675] truncate max-w-full">
                        {person.studentId}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </main>

          {/* 签到主页页脚（提供独立的 /admin 入口链接） */}
          <footer className="mt-6 sm:mt-10 py-6 sm:py-8 px-4 text-center text-xs text-[#8E8675] bg-[#f7f7ef] flex flex-col items-center space-y-1.5">
            <p className="font-gaegu text-base tracking-wide">今日露脸签到册 · InsightFace x 飞书妙搭</p>
            <button
              id="goto-admin-footer-btn"
              onClick={() => navigateTo('/admin')}
              className="font-gaegu text-sm text-[#8E8675]/80 hover:text-[#B25A45] underline decoration-dashed transition-colors"
            >
              管理后台入口 (/admin)
            </button>
          </footer>
        </>
      ) : (
        /* ---------------- 界面 2：管理后台独立界面 (/admin) ---------------- */
        <div className="flex-1 flex flex-col bg-[#f7f7ef]">
          {!isAdminAuthenticated ? (
            /* 未认证：展示管理员登录页面，含初始用户名密码提示 */
            <main className="flex-1 flex items-center justify-center p-4">
              <AdminLoginView
                onLoginSuccess={handleAdminLoginSuccess}
                onBackToCheckin={() => navigateTo('/')}
              />
            </main>
          ) : (
            /* 已认证：展示管理后台顶部专属操作栏与管理面板 */
            <>
              {/* 后台专属顶栏 */}
              <header className="w-full bg-[#EEE9DF] border-b border-[#D6CEC1] px-4 py-3 sticky top-0 z-30 shadow-xs">
                <div className="max-w-4xl mx-auto flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center space-x-3">
                    <button
                      id="admin-back-to-home-btn"
                      onClick={() => navigateTo('/')}
                      className="flex items-center space-x-1.5 px-3 py-1.5 bg-[#FFFCF8] hover:bg-[#F3EFE6] text-[#4A453B] rounded-xl border border-[#D6CEC1] text-xs font-gaegu text-base transition-all active:scale-95"
                    >
                      <ArrowLeft className="w-4 h-4 text-[#B25A45]" />
                      <span>返回刷脸签到</span>
                    </button>

                    <div className="h-4 w-px bg-[#D6CEC1]" />

                    <div className="flex items-center space-x-2">
                      <span className="font-gaegu text-xl font-bold text-[#4A453B]">
                        系统管理控制台
                      </span>
                      <span className="vintage-stamp-green text-[11px] px-2 py-0.5">
                        管理员: {adminUsername}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <button
                      id="admin-change-password-btn"
                      onClick={() => {
                        setChangePwdMsg({ text: '', isError: false });
                        setIsChangePwdOpen(true);
                      }}
                      className="flex items-center space-x-1 px-3 py-1.5 bg-[#FFFCF8] hover:bg-[#F3EFE6] text-[#5C5648] rounded-xl border border-[#D6CEC1] text-xs font-gaegu text-base transition-all"
                    >
                      <KeyRound className="w-3.5 h-3.5 text-[#8E8675]" />
                      <span>修改密码</span>
                    </button>

                    <button
                      id="admin-logout-btn"
                      onClick={handleAdminLogout}
                      className="flex items-center space-x-1 px-3 py-1.5 bg-[#F8EAE7] hover:bg-[#F2DCD8] text-[#C27D6B] rounded-xl border border-[#E5A99B] text-xs font-gaegu text-base transition-all"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>退出登录</span>
                    </button>
                  </div>
                </div>
              </header>

              {/* 后台主体 */}
              <main className="flex-1 max-w-4xl w-full mx-auto px-4 py-6 sm:p-6">
                <AdminPanel
                  persons={persons}
                  onAddPerson={handleAddPerson}
                  onDeletePerson={handleDeletePerson}
                  feishuConfig={feishuConfig}
                  onUpdateFeishuConfig={handleUpdateFeishuConfig}
                  logs={logs}
                  onClearLogs={handleClearLogs}
                  onRetryLog={handleRetrySingleLog}
                  onRetryAllFailedLogs={handleRetryAllFailedLogs}
                  onOpenHttpsGuide={() => setIsHttpsGuideOpen(true)}
                  isDefaultPassword={isDefaultPassword}
                  onChangePasswordClick={() => setIsChangePwdOpen(true)}
                />
              </main>

              {/* 后台页脚 */}
              <footer className="py-4 px-4 text-center text-xs text-[#8E8675] bg-[#EEE9DF] border-t border-[#D6CEC1]">
                <p className="font-gaegu text-sm">管理后台 · InsightFace x 飞书妙搭 · 当前账号：{adminUsername}</p>
              </footer>
            </>
          )}
        </div>
      )}

      {/* 修改密码弹窗 */}
      {isChangePwdOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="card w-full max-w-sm p-6 relative space-y-4">
            <div className="paper-clip" />
            <div className="flex items-center justify-between pb-2 border-b border-[#E3DCD1]">
              <div className="flex items-center space-x-2">
                <KeyRound className="w-5 h-5 text-[#B25A45]" />
                <h3 className="font-gaegu text-2xl font-bold text-[#4A453B]">修改管理员密码</h3>
              </div>
              <button
                onClick={() => setIsChangePwdOpen(false)}
                className="p-1 rounded-lg text-[#8E8675] hover:text-[#4A453B]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {changePwdMsg.text && (
              <div
                className={`p-2.5 rounded-xl text-xs flex items-center space-x-1.5 ${
                  changePwdMsg.isError
                    ? 'bg-[#F8EAE7] border border-[#E5A99B] text-[#C27D6B]'
                    : 'bg-[#EDF5EE] border border-[#C5DEC9] text-[#4F7B57]'
                }`}
              >
                <span>{changePwdMsg.text}</span>
              </div>
            )}

            <form onSubmit={handleSaveNewPassword} className="space-y-3">
              <div>
                <label className="font-gaegu text-base text-[#4A453B] block">原密码</label>
                <input
                  type="password"
                  id="admin-old-pwd-input"
                  value={oldPasswordInput}
                  onChange={e => setOldPasswordInput(e.target.value)}
                  placeholder="请输入当前密码"
                  className="w-full px-3 py-2 bg-[#EEE8DE] border border-[#D6CEC1] rounded-xl text-xs text-[#4A453B] focus:outline-none focus:border-[#B25A45]"
                />
              </div>

              <div>
                <label className="font-gaegu text-base text-[#4A453B] block">新密码</label>
                <input
                  type="password"
                  id="admin-new-pwd-input"
                  value={newPasswordInput}
                  onChange={e => setNewPasswordInput(e.target.value)}
                  placeholder="请输入新密码（至少4位）"
                  className="w-full px-3 py-2 bg-[#EEE8DE] border border-[#D6CEC1] rounded-xl text-xs text-[#4A453B] focus:outline-none focus:border-[#B25A45]"
                />
              </div>

              <div>
                <label className="font-gaegu text-base text-[#4A453B] block">确认新密码</label>
                <input
                  type="password"
                  id="admin-confirm-pwd-input"
                  value={confirmPasswordInput}
                  onChange={e => setConfirmPasswordInput(e.target.value)}
                  placeholder="请再次输入新密码"
                  className="w-full px-3 py-2 bg-[#EEE8DE] border border-[#D6CEC1] rounded-xl text-xs text-[#4A453B] focus:outline-none focus:border-[#B25A45]"
                />
              </div>

              <div className="flex items-center space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsChangePwdOpen(false)}
                  className="flex-1 py-2 rounded-xl border border-[#D6CEC1] bg-[#FFFCF8] text-[#5C5648] text-xs font-gaegu text-base"
                >
                  取消
                </button>
                <button
                  type="submit"
                  id="admin-save-new-pwd-btn"
                  disabled={isSubmittingPwd}
                  className="flex-1 stamp-button stamp-button-primary py-2 rounded-xl text-xs font-gaegu text-base font-bold disabled:opacity-50"
                >
                  {isSubmittingPwd ? '正在更新后端...' : '保存新密码'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 签到结果弹窗 */}
      <CheckinResultModal
        result={checkinResult}
        onClose={handleCloseModal}
      />

      {/* HTTPS / 局域网调试说明 */}
      <HttpsGuideModal
        isOpen={isHttpsGuideOpen}
        onClose={() => setIsHttpsGuideOpen(false)}
      />
    </div>
  );
}
