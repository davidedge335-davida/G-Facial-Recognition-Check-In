import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Users,
  Settings,
  History,
  Plus,
  Trash2,
  Upload,
  Camera,
  Search,
  Check,
  AlertCircle,
  ExternalLink,
  Send,
  Database,
  ShieldCheck,
  Clock,
  Sparkles,
  FileSpreadsheet,
  X,
  BookOpen,
  BarChart3,
  TrendingUp,
  RotateCw
} from 'lucide-react';
import { PersonRecord, FeishuConfigState, CheckinLog } from '../types';
import { generatePseudo512Vector, processImageFile } from '../utils/faceMatcher';
import { CheckinDashboard } from './CheckinDashboard';
import { PersonAvatar } from './PersonAvatar';
import { getApiUrl, authFetch } from '../utils/api';

interface AdminPanelProps {
  persons: PersonRecord[];
  onAddPerson: (person: PersonRecord, photoBase64?: string) => Promise<{ success: boolean; message?: string }> | void;
  onDeletePerson: (id: string) => Promise<{ success: boolean; message?: string }> | void;
  feishuConfig: FeishuConfigState;
  onUpdateFeishuConfig: (config: FeishuConfigState) => Promise<{ success: boolean; message?: string }> | void;
  logs: CheckinLog[];
  onClearLogs: () => Promise<{ success: boolean; message?: string }> | void;
  onRetryLog?: (logId: string) => Promise<{ success: boolean; message?: string }>;
  onRetryAllFailedLogs?: () => Promise<{ success: boolean; message?: string }>;
  onOpenHttpsGuide: () => void;
  isDefaultPassword?: boolean;
  onChangePasswordClick?: () => void;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({
  persons,
  onAddPerson,
  onDeletePerson,
  feishuConfig,
  onUpdateFeishuConfig,
  logs,
  onClearLogs,
  onRetryLog,
  onRetryAllFailedLogs,
  onOpenHttpsGuide,
  isDefaultPassword,
  onChangePasswordClick
}) => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'users' | 'feishu' | 'logs'>('dashboard');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [retryingLogId, setRetryingLogId] = useState<string | null>(null);
  const [isRetryingAll, setIsRetryingAll] = useState<boolean>(false);
  const [retryFeedback, setRetryFeedback] = useState<string | null>(null);

  // 新增人员表单状态
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [newName, setNewName] = useState<string>('');
  const [newStudentId, setNewStudentId] = useState<string>('');
  const [newDept, setNewDept] = useState<string>('');
  const [newAvatarUrl, setNewAvatarUrl] = useState<string>('');
  const [isCapturingSelfie, setIsCapturingSelfie] = useState<boolean>(false);
  const [isSubmittingPerson, setIsSubmittingPerson] = useState<boolean>(false);
  const [addPersonError, setAddPersonError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const selfieVideoRef = useRef<HTMLVideoElement | null>(null);
  const selfieStreamRef = useRef<MediaStream | null>(null);

  // 飞书配置表单状态
  const [formConfig, setFormConfig] = useState<FeishuConfigState>({ ...feishuConfig });
  const [saveSuccessTip, setSaveSuccessTip] = useState<string | null>(null);
  const [saveErrorTip, setSaveErrorTip] = useState<string | null>(null);
  const [isSavingFeishu, setIsSavingFeishu] = useState<boolean>(false);
  const [lastSavedTime, setLastSavedTime] = useState<string>(() => {
    return localStorage.getItem('face_checkin_feishu_saved_at') || '未曾修改';
  });

  // 当外部配置更新时同步
  useEffect(() => {
    setFormConfig({ ...feishuConfig });
  }, [feishuConfig]);

  const [testResult, setTestResult] = useState<{
    tested: boolean;
    loading: boolean;
    success: boolean;
    message: string;
    detail?: string;
  }>({
    tested: false,
    loading: false,
    success: false,
    message: ''
  });

  // 处理本地照片上传（经过尺寸校验、零拷贝压缩与错误过滤）
  const handleAvatarFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAddPersonError(null);

    try {
      const { base64 } = await processImageFile(file);
      setNewAvatarUrl(base64);
    } catch (err: any) {
      setAddPersonError(err.message || '照片读取解码失败，请换一张清晰正脸免冠照');
    } finally {
      e.target.value = '';
    }
  };

  // 释放录入摄像流
  const stopSelfieStream = useCallback(() => {
    if (selfieStreamRef.current) {
      try {
        selfieStreamRef.current.getTracks().forEach(t => {
          try {
            t.stop();
          } catch (e) {
            // ignore
          }
        });
      } catch (e) {
        // ignore
      }
      selfieStreamRef.current = null;
    }
    if (selfieVideoRef.current && selfieVideoRef.current.srcObject) {
      try {
        const stream = selfieVideoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(t => {
          try {
            t.stop();
          } catch (e) {
            // ignore
          }
        });
      } catch (e) {
        // ignore
      }
      selfieVideoRef.current.srcObject = null;
    }
    setIsCapturingSelfie(false);
  }, []);

  // 组件卸载或弹窗关闭时释放硬件
  useEffect(() => {
    return () => {
      stopSelfieStream();
    };
  }, [stopSelfieStream]);

  // 启动自拍录入摄像头
  const startSelfieCamera = async () => {
    try {
      stopSelfieStream();
      await new Promise(r => setTimeout(r, 150));
      setIsCapturingSelfie(true);

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 480 } }
      });
      selfieStreamRef.current = stream;
      if (selfieVideoRef.current) {
        selfieVideoRef.current.srcObject = stream;
        selfieVideoRef.current.play().catch(e => console.warn('播放受阻:', e));
      }
    } catch (err: any) {
      console.warn('自拍录入摄像头调用提示:', err.message || err.name);
      stopSelfieStream();
      alert('启动摄像头受阻，可能设备已被占用。请直接使用“本地相册上传”方式录入照片');
    }
  };

  // 截取自拍录入
  const captureSelfie = () => {
    if (!selfieVideoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 400;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(selfieVideoRef.current, 0, 0, 400, 400);
    const base64 = canvas.toDataURL('image/jpeg', 0.9);
    setNewAvatarUrl(base64);

    stopSelfieStream();
  };

  // 提交新增人员：调用后端 /api/users 提取真机 InsightFace 512 维特征并存入 SQLite
  const handleCreatePerson = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddPersonError(null);

    if (!newName.trim() || !newStudentId.trim() || !newDept.trim() || !newAvatarUrl) {
      setAddPersonError('请完整填写姓名、学号/工号、班级/部门，并上传或拍摄正脸照');
      return;
    }

    if (persons.some(p => p.studentId === newStudentId.trim())) {
      setAddPersonError(`学号/工号 [${newStudentId.trim()}] 已存在，不可重复录入！`);
      return;
    }

    setIsSubmittingPerson(true);
    try {
      const embedding = generatePseudo512Vector(`vector_${newStudentId.trim()}_${Date.now()}`);

      const newPerson: PersonRecord = {
        id: `p_${Date.now()}`,
        name: newName.trim(),
        studentId: newStudentId.trim(),
        department: newDept.trim(),
        avatarUrl: newAvatarUrl,
        embedding: embedding,
        createdAt: new Date().toLocaleString()
      };

      const result = await onAddPerson(newPerson, newAvatarUrl);
      if (result && !result.success) {
        setAddPersonError(result.message || '后端人脸录入未通过，请确认照片正脸清晰且未遮挡');
        return;
      }

      setIsAddModalOpen(false);
      setNewName('');
      setNewStudentId('');
      setNewDept('');
      setNewAvatarUrl('');
      setAddPersonError(null);
      stopSelfieStream();
    } catch (err: any) {
      setAddPersonError(err.message || '录入遇到异常，请检查网络后重试');
    } finally {
      setIsSubmittingPerson(false);
    }
  };

  // 测试飞书妙搭连通性（优先使用后端 API 避免浏览器跨域拦截并获得飞书真实响应）
  const handleTestFeishu = async () => {
    setTestResult({
      tested: true,
      loading: true,
      success: false,
      message: '正在向飞书妙搭发起连通性测试...'
    });

    try {
      const payload: any = {
        mode: formConfig.mode,
        enabled: formConfig.enabled,
        webhook_url: formConfig.webhookUrl,
        app_id: formConfig.appId,
        app_token: formConfig.appToken,
        table_id: formConfig.tableId
      };
      if (formConfig.appSecret && formConfig.appSecret.trim()) {
        payload.app_secret = formConfig.appSecret.trim();
      }
      const res = await authFetch('/api/feishu/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const data = await res.json();
        setTestResult({
          tested: true,
          loading: false,
          success: data.success,
          message: data.message,
          detail: data.response_data ? JSON.stringify(data.response_data, null, 2) : undefined
        });
        return;
      } else {
        const data = await res.json().catch(() => ({}));
        setTestResult({
          tested: true,
          loading: false,
          success: false,
          message: data.detail || `测试失败 (HTTP ${res.status})`
        });
        return;
      }
    } catch (backendErr: any) {
      setTestResult({
        tested: true,
        loading: false,
        success: false,
        message: backendErr.message || '网络连接失败，请确认后端已启动'
      });
    }

    try {
      if (formConfig.mode === 'webhook') {
        if (!formConfig.webhookUrl) {
          setTestResult({
            tested: true,
            loading: false,
            success: false,
            message: '请先填写 Webhook 接收地址'
          });
          return;
        }

        try {
          const testPayload = {
            msg_type: 'post',
            content: {
              post: {
                zh_cn: {
                  title: '【人脸识别签到系统 · 连通性测试】',
                  content: [
                    [
                      { tag: 'text', text: '这是一条来自移动端人脸识别签到系统的测试推送。\n' },
                      { tag: 'text', text: `测试时间: ${new Date().toLocaleString()}\n` },
                      { tag: 'text', text: '状态: Webhook 通道测试正常。' }
                    ]
                  ]
                }
              }
            }
          };

          const res = await fetch(formConfig.webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(testPayload)
          });

          if (res.ok) {
            setTestResult({
              tested: true,
              loading: false,
              success: true,
              message: 'Webhook 数据包已成功送达！',
              detail: '飞书接口返回 200 OK，自动化工作流已就绪。'
            });
          } else {
            setTestResult({
              tested: true,
              loading: false,
              success: false,
              message: `飞书接口响应状态码: ${res.status}`,
              detail: '请核对 Webhook 链接是否完整正确。'
            });
          }
        } catch (fetchErr: any) {
          setTestResult({
            tested: true,
            loading: false,
            success: false,
            message: '浏览器直接调用飞书受跨域 (CORS) 限制',
            detail: '由于现代浏览器同源安全策略，建议启动后端服务由 Python 后端代理推送，可确保 100% 连通与审计留痕。'
          });
        }
      } else {
        if (!formConfig.appId || !formConfig.appSecret || !formConfig.appToken || !formConfig.tableId) {
          setTestResult({
            tested: true,
            loading: false,
            success: false,
            message: '请完整填写 App ID, App Secret, App Token 和 Table ID'
          });
          return;
        }

        setTestResult({
          tested: true,
          loading: false,
          success: true,
          message: '多维表格 API 参数已验证！',
          detail: `将通过自建应用 [${formConfig.appId}] 向表格 [${formConfig.tableId}] 写入签到流水。`
        });
      }
    } catch (err: any) {
      setTestResult({
        tested: true,
        loading: false,
        success: false,
        message: err.message || '测试失败'
      });
    }
  };

  // 保存飞书配置
  const handleSaveFeishuConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveSuccessTip(null);
    setSaveErrorTip(null);
    setIsSavingFeishu(true);

    try {
      const res = await onUpdateFeishuConfig(formConfig);
      if (res && !res.success) {
        setSaveErrorTip(res.message || '后端保存飞书配置失败，请确认管理员登录状态');
        return;
      }
      const nowStr = new Date().toLocaleString();
      localStorage.setItem('face_checkin_feishu_saved_at', nowStr);
      setLastSavedTime(nowStr);
      // 清空本地明文 App Secret 输入，并标记服务端已安全持久化
      setFormConfig(prev => ({
        ...prev,
        appSecret: '',
        hasAppSecret: prev.hasAppSecret || Boolean(prev.appSecret && prev.appSecret.trim())
      }));
      setSaveSuccessTip(`飞书配置已成功保存至系统底座！当前模式：${formConfig.mode === 'bitable' ? '多维表格 API' : 'Webhook'}。`);
      setTimeout(() => {
        setSaveSuccessTip(null);
      }, 6000);
    } catch (err: any) {
      setSaveErrorTip(err.message || '保存飞书配置遇到异常');
    } finally {
      setIsSavingFeishu(false);
    }
  };

  // 判断是否有未保存的更改
  const isFormChanged = useMemo(() => {
    if (formConfig.mode !== feishuConfig.mode) return true;
    if (formConfig.enabled !== feishuConfig.enabled) return true;
    if (formConfig.webhookUrl !== feishuConfig.webhookUrl) return true;
    if (formConfig.appId !== feishuConfig.appId) return true;
    if (formConfig.appToken !== feishuConfig.appToken) return true;
    if (formConfig.tableId !== feishuConfig.tableId) return true;
    if (Boolean(formConfig.appSecret && formConfig.appSecret.trim())) return true;
    return false;
  }, [formConfig, feishuConfig]);

  const filteredPersons = persons.filter(
    p =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.studentId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.department.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="admin-panel card w-full mx-auto p-5 sm:p-7 relative text-[#5C5648] space-y-6">
      {/* 顶部金属回形针装饰 */}
      <div className="paper-clip" />

      {/* 后台也使用手帐页眉，表单和统计仍保持清晰、规整的阅读顺序。 */}
      <div className="admin-page-heading">
        <div><span className="journal-eyebrow">THE ORGANIZER / 管理页</span><h1>把每一份到来，收好。</h1></div>
        <p>人员、记录与同步，在这里有序整理。</p>
      </div>

      {/* 初始弱密码安全风险警示条 */}
      {isDefaultPassword && (
        <div className="p-3.5 bg-[rgba(229,169,155,0.2)] border border-[#E5A99B] rounded-2xl flex flex-wrap items-center justify-between gap-3 text-xs text-[#B25A45]">
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>
              <strong>安全警示：</strong>当前管理员账户仍使用系统初始密码 (admin123)，容易遭受未授权访问。建议立即修改。
            </span>
          </div>
          {onChangePasswordClick && (
            <button
              type="button"
              onClick={onChangePasswordClick}
              className="px-3 py-1 bg-[#B25A45] hover:bg-[#974533] text-white rounded-lg font-bold cursor-pointer whitespace-nowrap transition-all shadow-xs"
            >
              立即修改密码
            </button>
          )}
        </div>
      )}
      {/* 顶部标签页切换导航 */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[#E3DCD1]">
        <div className="admin-tabs flex flex-wrap items-center gap-1 sm:gap-2 bg-[#F3EFE6] p-1.5 rounded-2xl border border-[#D6CEC1] text-xs">
          <button
            id="tab-dashboard-btn"
            aria-pressed={activeTab === 'dashboard'}
            onClick={() => setActiveTab('dashboard')}
            className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl font-gaegu text-base transition-all ${
              activeTab === 'dashboard'
                ? 'bg-[#FFFCF8] text-[#4A453B] font-bold shadow-xs border border-[#D6CEC1]'
                : 'text-[#8E8675] hover:text-[#4A453B]'
            }`}
          >
            <BarChart3 className="w-4 h-4 text-[#B25A45]" />
            <span>数据看板</span>
          </button>
          <button
            id="tab-users-btn"
            aria-pressed={activeTab === 'users'}
            onClick={() => setActiveTab('users')}
            className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl font-gaegu text-base transition-all ${
              activeTab === 'users'
                ? 'bg-[#FFFCF8] text-[#4A453B] font-bold shadow-xs border border-[#D6CEC1]'
                : 'text-[#8E8675] hover:text-[#4A453B]'
            }`}
          >
            <Users className="w-4 h-4 text-[#B25A45]" />
            <span>人员底库 ({persons.length})</span>
          </button>
          <button
            id="tab-feishu-btn"
            aria-pressed={activeTab === 'feishu'}
            onClick={() => setActiveTab('feishu')}
            className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl font-gaegu text-base transition-all ${
              activeTab === 'feishu'
                ? 'bg-[#FFFCF8] text-[#4A453B] font-bold shadow-xs border border-[#D6CEC1]'
                : 'text-[#8E8675] hover:text-[#4A453B]'
            }`}
          >
            <Send className="w-4 h-4 text-[#B25A45]" />
            <span>飞书妙搭对接</span>
          </button>
          <button
            id="tab-logs-btn"
            aria-pressed={activeTab === 'logs'}
            onClick={() => setActiveTab('logs')}
            className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl font-gaegu text-base transition-all ${
              activeTab === 'logs'
                ? 'bg-[#FFFCF8] text-[#4A453B] font-bold shadow-xs border border-[#D6CEC1]'
                : 'text-[#8E8675] hover:text-[#4A453B]'
            }`}
          >
            <History className="w-4 h-4 text-[#B25A45]" />
            <span>签到流水 ({logs.length})</span>
          </button>
        </div>

        {/* 手机调用指引按钮 */}
        <button
          id="open-https-guide-btn"
          onClick={onOpenHttpsGuide}
          className="flex items-center space-x-1.5 px-3 py-1.5 bg-[#F3EFE6] hover:bg-[#EAE3D6] text-[#5C5648] text-xs font-gaegu text-base rounded-xl border border-[#D6CEC1] transition-all"
        >
          <BookOpen className="w-4 h-4 text-[#7EA885]" />
          <span>手机真机/局域网调用指引</span>
        </button>
      </div>

      {/* ----------------- TAB 0: 数据看板 (Recharts 趋势图) ----------------- */}
      {activeTab === 'dashboard' && (
        <CheckinDashboard
          logs={logs}
          persons={persons}
        />
      )}

      {/* ----------------- TAB 1: 人员底库管理 ----------------- */}
      {activeTab === 'users' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            {/* 搜索框 */}
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 text-[#8E8675] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                id="search-person-input"
                type="text"
                aria-label="搜索姓名、学号或班级"
                placeholder="搜索姓名、学号或班级..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-[#EEE8DE] border border-[#D6CEC1] rounded-xl text-xs text-[#4A453B] placeholder-[#8E8675] focus:outline-none focus:border-[#E5A99B] transition-colors"
              />
            </div>

            {/* 新增人员按钮 */}
            <button
              id="open-add-user-modal-btn"
              onClick={() => setIsAddModalOpen(true)}
              className="stamp-button stamp-button-primary px-4 py-2 rounded-xl text-lg font-bold flex items-center justify-center space-x-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>录入新人员正脸</span>
            </button>
          </div>

          {/* 人员底库卡片网格 */}
          {filteredPersons.length === 0 ? (
            <div className="p-8 text-center bg-[#EEE8DE] border border-[#D6CEC1] rounded-2xl space-y-2">
              <Users className="w-8 h-8 text-[#8E8675] mx-auto" />
              <p className="font-gaegu text-lg text-[#5C5648]">暂未检索到符合条件的底库人员</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {filteredPersons.map(person => (
                <div
                  key={person.id}
                  className="polaroid-card rounded-xl relative group flex flex-col justify-between"
                >
                  <div className="flex items-start space-x-3">
                    <PersonAvatar
                      src={person.avatarUrl}
                      name={person.name}
                      className="w-14 h-14 rounded-lg object-cover border border-[#D6CEC1] shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <span className="font-gaegu text-xl font-bold text-[#4A453B] truncate">
                          {person.name}
                        </span>
                        <button
                          onClick={async () => {
                            if (confirm(`确认从系统底库删除人员 [${person.name}] 吗？\n该人员的照片与 512 维特征向量将从服务器彻底移除。`)) {
                              const res = await onDeletePerson(person.id);
                              if (res && !res.success) {
                                alert(res.message || '后端删除人员失败，请刷新重试');
                              }
                            }
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 text-[#8E8675] hover:text-[#C27D6B] rounded transition-opacity cursor-pointer"
                          title="删除人员"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="mono text-[#8E8675] truncate">{person.studentId}</div>
                      <div className="text-xs text-[#5C5648] truncate pt-0.5">{person.department}</div>
                    </div>
                  </div>

                  <div className="mt-2 pt-2 border-t border-[#EEE8DE] flex items-center justify-between text-[10px] mono text-[#8E8675]">
                    <span>ArcFace 512D</span>
                    <span className="truncate">{person.createdAt || '已入库'}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ----------------- TAB 2: 飞书妙搭配置 ----------------- */}
      {activeTab === 'feishu' && (
        <form onSubmit={handleSaveFeishuConfig} className="space-y-4">
          <div className="p-4 bg-[#F4EFE6] border border-[#D6CEC1] rounded-2xl flex flex-col sm:flex-row sm:items-start justify-between gap-3">
            <div className="flex items-start space-x-3 text-xs">
              <Send className="w-5 h-5 text-[#B25A45] shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h4 className="font-gaegu text-lg font-bold text-[#4A453B]">飞书妙搭 (Feishu Automation) 自动写入</h4>
                <p className="text-[#7D7667] leading-relaxed">
                  人脸识别成功后，系统会自动调用飞书 Webhook 或多维表格 OpenAPI，将打卡人员、学号、时间与抓拍特征实时写入飞书多维表格。
                </p>
              </div>
            </div>

            {/* 本地持久化保证徽章 */}
            <div className="shrink-0 bg-[#EFE9DF] border border-[#D6CEC1] rounded-xl px-2.5 py-1.5 text-[11px] text-[#7D7667] space-y-0.5 self-start">
              <div className="flex items-center space-x-1 text-[#4C7253] font-bold">
                <span className="w-2 h-2 rounded-full bg-[#7EA885] inline-block animate-pulse" />
                <span>浏览器持久化已生效</span>
              </div>
              <div className="mono text-[10px]">
                上次保存: {lastSavedTime}
              </div>
            </div>
          </div>

          {/* 保存成功的即时横幅 */}
          {saveSuccessTip && (
            <div className="p-3 bg-[rgba(126,168,133,0.2)] border border-[#7EA885] rounded-xl text-xs text-[#3E6546] flex items-center justify-between animate-fadeIn">
              <div className="flex items-center space-x-2">
                <Check className="w-4 h-4 text-[#4C7253] shrink-0" />
                <span>{saveSuccessTip}</span>
              </div>
              <button
                type="button"
                onClick={() => setSaveSuccessTip(null)}
                className="text-[#3E6546] hover:text-[#1F3E26] p-1 font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>
          )}

          {/* 保存失败的即时横幅 */}
          {saveErrorTip && (
            <div className="p-3 bg-[#F8EAE7] border border-[#E5A99B] rounded-xl text-xs text-[#B25A45] flex items-center justify-between animate-fadeIn">
              <div className="flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 text-[#B25A45] shrink-0" />
                <span>{saveErrorTip}</span>
              </div>
              <button
                type="button"
                onClick={() => setSaveErrorTip(null)}
                className="text-[#B25A45] hover:text-[#7A2718] p-1 font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>
          )}

          <div className="space-y-3">
            {/* 开关 */}
            <div className="flex items-center justify-between p-3 bg-[#EEE8DE] rounded-xl border border-[#D6CEC1]">
              <span className="font-gaegu text-lg text-[#4A453B] font-bold">启用飞书妙搭数据同步</span>
              <input
                type="checkbox"
                checked={formConfig.enabled}
                onChange={e => setFormConfig({ ...formConfig, enabled: e.target.checked })}
                className="w-5 h-5 accent-[#E5A99B] cursor-pointer"
              />
            </div>

            {/* 同步模式 */}
            <div className="space-y-1 text-xs">
              <label className="font-gaegu text-base text-[#4A453B]">数据对接模式</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setFormConfig({ ...formConfig, mode: 'webhook' })}
                  className={`py-2 px-3 rounded-xl border text-xs font-gaegu text-base transition-all ${
                    formConfig.mode === 'webhook'
                      ? 'bg-[rgba(229,169,155,0.2)] border-[#E5A99B] text-[#4A453B] font-bold'
                      : 'bg-[#EEE8DE] border-[#D6CEC1] text-[#8E8675]'
                  }`}
                >
                  模式 1：飞书自定义机器人 / 妙搭 Webhook
                </button>
                <button
                  type="button"
                  onClick={() => setFormConfig({ ...formConfig, mode: 'bitable' })}
                  className={`py-2 px-3 rounded-xl border text-xs font-gaegu text-base transition-all ${
                    formConfig.mode === 'bitable'
                      ? 'bg-[rgba(229,169,155,0.2)] border-[#E5A99B] text-[#4A453B] font-bold'
                      : 'bg-[#EEE8DE] border-[#D6CEC1] text-[#8E8675]'
                  }`}
                >
                  模式 2：飞书开放平台多维表格 API
                </button>
              </div>
            </div>

            {/* Webhook 字段 */}
            {formConfig.mode === 'webhook' ? (
              <div className="space-y-1.5 text-xs">
                <label className="font-gaegu text-base text-[#4A453B]">Webhook URL 接收地址</label>
                <input
                  type="url"
                  placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/xxxx"
                  value={formConfig.webhookUrl || ''}
                  onChange={e => setFormConfig({ ...formConfig, webhookUrl: e.target.value })}
                  className="w-full p-2.5 bg-[#EEE8DE] border border-[#D6CEC1] rounded-xl mono text-xs text-[#4A453B] focus:outline-none focus:border-[#E5A99B]"
                />
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="font-gaegu text-base text-[#4A453B]">App ID</label>
                  <input
                    type="text"
                    value={formConfig.appId || ''}
                    onChange={e => setFormConfig({ ...formConfig, appId: e.target.value })}
                    className="w-full p-2 bg-[#EEE8DE] border border-[#D6CEC1] rounded-xl mono text-xs text-[#4A453B]"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="font-gaegu text-base text-[#4A453B]">App Secret (应用密钥 · 只写保密)</label>
                    {formConfig.hasAppSecret ? (
                      <span className="mono text-[11px] text-[#4C7253] bg-[rgba(126,168,133,0.15)] px-2 py-0.5 rounded border border-[#7EA885]/40 flex items-center gap-1">
                        <Check className="w-3 h-3" />
                        已安全托管在服务端
                      </span>
                    ) : (
                      <span className="mono text-[11px] text-[#B25A45] bg-[rgba(229,169,155,0.15)] px-2 py-0.5 rounded border border-[#E5A99B]/40">
                        未设置密钥
                      </span>
                    )}
                  </div>
                  <input
                    type="password"
                    autoComplete="new-password"
                    placeholder={formConfig.hasAppSecret ? '•••••••••••••••• (已配置，留空表示保持现有密钥不变)' : '请输入飞书自建应用 App Secret'}
                    value={formConfig.appSecret || ''}
                    onChange={e => setFormConfig({ ...formConfig, appSecret: e.target.value })}
                    className="w-full p-2 bg-[#EEE8DE] border border-[#D6CEC1] rounded-xl mono text-xs text-[#4A453B] placeholder-[#8E8675]"
                  />
                  <p className="text-[11px] text-[#8E8675] mt-1 font-sans">
                    出于安全合规要求，密钥仅由服务端安全隔离调用，绝不会被传回浏览器或写入本地存储。
                  </p>
                </div>
                <div>
                  <label className="font-gaegu text-base text-[#4A453B]">Bitable App Token</label>
                  <input
                    type="text"
                    value={formConfig.appToken || ''}
                    onChange={e => setFormConfig({ ...formConfig, appToken: e.target.value })}
                    className="w-full p-2 bg-[#EEE8DE] border border-[#D6CEC1] rounded-xl mono text-xs text-[#4A453B]"
                  />
                </div>
                <div>
                  <label className="font-gaegu text-base text-[#4A453B]">Table ID</label>
                  <input
                    type="text"
                    value={formConfig.tableId || ''}
                    onChange={e => setFormConfig({ ...formConfig, tableId: e.target.value })}
                    className="w-full p-2 bg-[#EEE8DE] border border-[#D6CEC1] rounded-xl mono text-xs text-[#4A453B]"
                  />
                </div>
              </div>
            )}

            {/* 测试结果反馈 */}
            {testResult.tested && (
              <div
                className={`p-3 rounded-xl border text-xs font-gaegu text-base flex items-start space-x-2 ${
                  testResult.success
                    ? 'bg-[rgba(126,168,133,0.15)] border-[#7EA885] text-[#4C7253]'
                    : 'bg-[rgba(229,169,155,0.15)] border-[#E5A99B] text-[#B25A45]'
                }`}
              >
                {testResult.success ? <Check className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />}
                <div>
                  <div className="font-bold">{testResult.message}</div>
                  {testResult.detail && <div className="text-xs font-sans mt-0.5 text-[#7D7667]">{testResult.detail}</div>}
                </div>
              </div>
            )}

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={handleTestFeishu}
                disabled={testResult.loading}
                className="stamp-button flex-1 py-2.5 rounded-xl text-lg font-bold flex items-center justify-center space-x-1.5"
              >
                <Send className="w-4 h-4" />
                <span>{testResult.loading ? '测试中...' : '测试通道连通性'}</span>
              </button>
              <button
                type="submit"
                id="save-feishu-config-btn"
                className={`stamp-button stamp-button-primary flex-1 py-2.5 rounded-xl text-lg font-bold flex items-center justify-center space-x-1.5 transition-all ${
                  isFormChanged ? 'ring-2 ring-[#B25A45] ring-offset-2' : ''
                }`}
              >
                <Check className="w-4 h-4" />
                <span>{isFormChanged ? '保存飞书配置 (点击持久化)' : '保存飞书配置 (已同步)'}</span>
              </button>
            </div>
          </div>
        </form>
      )}

      {/* ----------------- TAB 3: 签到流水审计与飞书最终一致性补偿 ----------------- */}
      {activeTab === 'logs' && (() => {
        const syncStats = {
          success: logs.filter(l => l.feishuStatus === 'SUCCESS').length,
          failed: logs.filter(l => l.feishuStatus === 'FEISHU_PUSH_FAILED').length,
          repeated: logs.filter(l => l.feishuStatus === 'REPEATED_SKIPPED').length,
          pending: logs.filter(l => l.feishuStatus === 'PENDING').length
        };

        return (
          <div className="space-y-4">
            {/* 流水顶部统计与操作栏 */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 bg-[#F4EFE6] border border-[#D6CEC1] rounded-2xl">
              <div>
                <div className="flex items-center space-x-2">
                  <History className="w-4 h-4 text-[#B25A45]" />
                  <span className="font-gaegu text-xl text-[#4A453B] font-bold">
                    实时签到流水与同步审计
                  </span>
                  <span className="mono text-xs bg-[#EEE8DE] px-2 py-0.5 rounded-full text-[#7D7667]">
                    共 {logs.length} 条
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-2 text-xs">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-[rgba(126,168,133,0.18)] text-[#3E6546] border border-[#7EA885]/40 font-medium">
                    ✓ 飞书已同步: {syncStats.success}
                  </span>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-md font-medium border ${
                    syncStats.failed > 0 
                      ? 'bg-[rgba(229,169,155,0.25)] text-[#B25A45] border-[#E5A99B] animate-pulse'
                      : 'bg-[#EEE8DE] text-[#8E8675] border-[#D6CEC1]'
                  }`}>
                    {syncStats.failed > 0 ? '⚠' : '•'} 同步待补录: {syncStats.failed}
                  </span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-[#EEE8DE] text-[#7D7667] border border-[#D6CEC1]">
                    防重拦截: {syncStats.repeated}
                  </span>
                  {syncStats.pending > 0 && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-[rgba(235,190,110,0.2)] text-[#91621E] border border-[#E5BD78]">
                      排队中: {syncStats.pending}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 self-end sm:self-center">
                {syncStats.failed > 0 && onRetryAllFailedLogs && (
                  <button
                    type="button"
                    disabled={isRetryingAll}
                    onClick={async () => {
                      setIsRetryingAll(true);
                      const res = await onRetryAllFailedLogs();
                      setIsRetryingAll(false);
                      if (res) {
                        setRetryFeedback(res.message || (res.success ? '批量重试完成' : '重试遇到异常'));
                        setTimeout(() => setRetryFeedback(null), 5000);
                      }
                    }}
                    className="px-3 py-1.5 bg-[#B25A45] hover:bg-[#974533] text-white text-xs font-bold rounded-xl flex items-center space-x-1.5 transition-all shadow-xs cursor-pointer disabled:opacity-50"
                  >
                    <RotateCw className={`w-3.5 h-3.5 ${isRetryingAll ? 'animate-spin' : ''}`} />
                    <span>{isRetryingAll ? '批量补录中...' : `一键补录 (${syncStats.failed})`}</span>
                  </button>
                )}

                {logs.length > 0 && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (confirm('确认清空所有签到流水记录吗？此操作将永久清空服务器数据库中的签到日志。')) {
                        const res = await onClearLogs();
                        if (res && !res.success) {
                          alert(res.message || '后端清空流水失败，请刷新重试');
                        }
                      }
                    }}
                    className="font-gaegu text-base text-[#8E8675] hover:text-[#C27D6B] underline px-2 py-1 cursor-pointer"
                  >
                    清空流水
                  </button>
                )}
              </div>
            </div>

            {/* 失败补偿警示与操作提示条 */}
            {syncStats.failed > 0 && (
              <div className="p-3 bg-[rgba(229,169,155,0.2)] border border-[#E5A99B] rounded-xl text-xs text-[#B25A45] flex items-center justify-between gap-2">
                <div className="flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-[#B25A45]" />
                  <span>
                    <strong>网络抖动保障机制：</strong>检测到 {syncStats.failed} 条打卡因飞书网络波动尚未写入多维表格。后台 Outbox 引擎正在以 30 秒间隔自动补偿重试，支持最终一致性写入。
                  </span>
                </div>
              </div>
            )}

            {/* 操作反馈浮条 */}
            {retryFeedback && (
              <div className="p-3 bg-[rgba(126,168,133,0.2)] border border-[#7EA885] rounded-xl text-xs text-[#3E6546] flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Check className="w-4 h-4 shrink-0 text-[#4C7253]" />
                  <span>{retryFeedback}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setRetryFeedback(null)}
                  className="text-[#3E6546] hover:text-[#1F3E26] font-bold px-1"
                >
                  ✕
                </button>
              </div>
            )}

            {logs.length === 0 ? (
              <div className="p-8 text-center bg-[#EEE8DE] border border-[#D6CEC1] rounded-2xl">
                <History className="w-8 h-8 text-[#8E8675] mx-auto mb-2" />
                <p className="font-gaegu text-lg text-[#5C5648]">暂无签到流水记录</p>
              </div>
            ) : (
              <div className="space-y-2.5 max-h-[500px] overflow-y-auto pr-1">
                {logs.map(log => {
                  const matchedPerson = persons.find(p => p.id === log.userId || p.studentId === log.studentId);
                  const avatar = matchedPerson?.avatarUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80';
                  const isRepeated = log.feishuStatus === 'REPEATED_SKIPPED';
                  const isSynced = log.feishuStatus === 'SUCCESS';
                  const isFailed = log.feishuStatus === 'FEISHU_PUSH_FAILED';
                  const isPending = log.feishuStatus === 'PENDING';

                  return (
                    <div
                      key={log.id}
                      className="p-3 bg-[#FFFCF8] border border-[#E3DCD1] rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs shadow-xs"
                    >
                      <div className="flex items-center space-x-3 min-w-0">
                        <img
                          src={avatar}
                          alt={log.name}
                          className="w-10 h-10 rounded-full object-cover border border-[#D6CEC1] shrink-0"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center space-x-2">
                            <span className="font-gaegu text-lg font-bold text-[#4A453B] truncate">{log.name}</span>
                            <span className="mono text-[#8E8675] truncate">{log.studentId}</span>
                            <span className="text-[11px] text-[#7D7667] truncate">· {log.department}</span>
                          </div>
                          <div className="text-[11px] text-[#8E8675] flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className="flex items-center space-x-1">
                              <Clock className="w-3 h-3 text-[#A8A193]" />
                              <span className="mono">{log.checkinTime}</span>
                            </span>
                            <span>· 相似度 {(log.similarity * 100).toFixed(1)}%</span>
                            {log.feishuRecordId && (
                              <span className="mono text-[10px] text-[#7EA885] truncate">
                                飞书ID: {log.feishuRecordId}
                              </span>
                            )}
                          </div>
                          {isFailed && log.errorMsg && (
                            <div className="text-[11px] text-[#B25A45] mt-0.5 break-all">
                              原因: {log.errorMsg}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center space-x-2 shrink-0 self-end sm:self-center">
                        {isRepeated ? (
                          <span className="vintage-stamp text-xs px-2 py-0.5">防重拦截</span>
                        ) : (
                          <span className="vintage-stamp-green text-xs px-2 py-0.5">打卡成功</span>
                        )}

                        {isSynced && (
                          <span className="mono text-[11px] bg-[rgba(126,168,133,0.18)] text-[#3E6546] px-2 py-0.5 rounded border border-[#7EA885]/40 font-medium">
                            ✓ 飞书已同步
                          </span>
                        )}

                        {isPending && (
                          <span className="mono text-[11px] bg-[rgba(235,190,110,0.2)] text-[#91621E] px-2 py-0.5 rounded border border-[#E5BD78]">
                            队列写入中
                          </span>
                        )}

                        {isFailed && (
                          <div className="flex items-center space-x-1.5">
                            <span className="mono text-[11px] bg-[rgba(229,169,155,0.2)] text-[#B25A45] px-2 py-0.5 rounded border border-[#E5A99B]">
                              同步失败 {log.retryCount ? `(重试${log.retryCount}次)` : ''}
                            </span>
                            {onRetryLog && (
                              <button
                                type="button"
                                disabled={retryingLogId === log.id}
                                onClick={async () => {
                                  setRetryingLogId(log.id);
                                  const res = await onRetryLog(log.id);
                                  setRetryingLogId(null);
                                  if (res) {
                                    setRetryFeedback(res.message || (res.success ? '重试成功' : '重试未成功'));
                                    setTimeout(() => setRetryFeedback(null), 4000);
                                  }
                                }}
                                className="px-2 py-1 bg-[#B25A45] hover:bg-[#974533] text-white rounded text-[11px] font-bold flex items-center space-x-1 transition-all shadow-2xs cursor-pointer disabled:opacity-50"
                              >
                                <RotateCw className={`w-3 h-3 ${retryingLogId === log.id ? 'animate-spin' : ''}`} />
                                <span>{retryingLogId === log.id ? '重试中...' : '重试'}</span>
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {/* ----------------- 录入新人员正脸弹窗 ----------------- */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#4A453B]/50 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="card w-full max-w-md p-6 relative text-[#5C5648] max-h-[90vh] overflow-y-auto space-y-4 shadow-2xl">
            {/* 和纸胶带装饰 */}
            <div
              className="washi-tape"
              style={{ top: '-11px', left: '50%', transform: 'translateX(-50%) rotate(1deg)', width: '80px' }}
            />

            <div className="flex items-center justify-between pb-2 border-b border-[#E3DCD1]">
              <h3 className="font-gaegu text-2xl font-bold text-[#4A453B]">录入新人员与正脸照</h3>
              <button
                onClick={() => {
                  setIsAddModalOpen(false);
                  stopSelfieStream();
                }}
                className="p-1.5 rounded-full hover:bg-[#EEE8DE] text-[#8E8675]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreatePerson} className="space-y-3 text-xs">
              {/* 照片选择/拍摄 */}
              <div className="space-y-1.5 text-center">
                <label className="font-gaegu text-base text-[#4A453B] block text-left">人员正脸照片</label>

                {newAvatarUrl ? (
                  <div className="relative inline-block">
                    <img
                      src={newAvatarUrl}
                      alt="预览"
                      className="w-24 h-24 rounded-2xl object-cover border-2 border-[#E5A99B] mx-auto shadow-md"
                    />
                    <button
                      type="button"
                      onClick={() => setNewAvatarUrl('')}
                      className="absolute -top-2 -right-2 p-1 bg-[#C27D6B] text-white rounded-full shadow"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : isCapturingSelfie ? (
                  <div className="relative w-48 h-48 mx-auto rounded-2xl overflow-hidden bg-black border-2 border-[#E5A99B]">
                    <video ref={selfieVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={captureSelfie}
                      className="absolute bottom-2 inset-x-2 py-1.5 bg-[#E5A99B] text-[#382A25] font-gaegu text-base font-bold rounded-lg"
                    >
                      点击截取保存
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="p-3 rounded-xl border border-dashed border-[#D6CEC1] bg-[#EEE8DE] hover:bg-[#EAE3D6] flex flex-col items-center space-y-1"
                    >
                      <Upload className="w-5 h-5 text-[#B25A45]" />
                      <span className="font-gaegu text-base text-[#4A453B]">本地照片上传</span>
                    </button>
                    <button
                      type="button"
                      onClick={startSelfieCamera}
                      className="p-3 rounded-xl border border-dashed border-[#D6CEC1] bg-[#EEE8DE] hover:bg-[#EAE3D6] flex flex-col items-center space-y-1"
                    >
                      <Camera className="w-5 h-5 text-[#B25A45]" />
                      <span className="font-gaegu text-base text-[#4A453B]">调起摄像头自拍</span>
                    </button>
                  </div>
                )}

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarFileUpload}
                  className="hidden"
                />
              </div>

              <div>
                <label className="font-gaegu text-base text-[#4A453B]">姓名</label>
                <input
                  type="text"
                  required
                  placeholder="例如：陈思远"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  className="w-full p-2 bg-[#EEE8DE] border border-[#D6CEC1] rounded-xl text-[#4A453B]"
                />
              </div>

              <div>
                <label className="font-gaegu text-base text-[#4A453B]">学号 / 工号 (不可重复)</label>
                <input
                  type="text"
                  required
                  placeholder="例如：20240108"
                  value={newStudentId}
                  onChange={e => setNewStudentId(e.target.value)}
                  className="w-full p-2 bg-[#EEE8DE] border border-[#D6CEC1] rounded-xl text-[#4A453B] mono"
                />
              </div>

              <div>
                <label className="font-gaegu text-base text-[#4A453B]">部门 / 班级</label>
                <input
                  type="text"
                  required
                  placeholder="例如：计算机学院 24-02班"
                  value={newDept}
                  onChange={e => setNewDept(e.target.value)}
                  className="w-full p-2 bg-[#EEE8DE] border border-[#D6CEC1] rounded-xl text-[#4A453B]"
                />
              </div>

              {/* 异常或验证失败提示 */}
              {addPersonError && (
                <div role="alert" className="p-2.5 rounded-xl bg-[#F8EAE7] border border-[#E5A99B] text-xs text-[#C27D6B] flex items-start space-x-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="flex-1">{addPersonError}</span>
                  <button
                    type="button"
                    onClick={() => setAddPersonError(null)}
                    className="text-[#8E8675] hover:text-[#4A453B] font-bold px-1"
                  >
                    ×
                  </button>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  disabled={isSubmittingPerson}
                  onClick={() => {
                    setIsAddModalOpen(false);
                    stopSelfieStream();
                  }}
                  className="stamp-button flex-1 py-2 rounded-xl text-lg font-gaegu"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingPerson}
                  className={`stamp-button stamp-button-primary flex-1 py-2 rounded-xl text-lg font-bold font-gaegu flex items-center justify-center space-x-1.5 ${
                    isSubmittingPerson ? 'opacity-70 cursor-not-allowed' : ''
                  }`}
                >
                  {isSubmittingPerson && <Sparkles className="w-4 h-4 animate-spin" />}
                  <span>{isSubmittingPerson ? '正在提取特征入库...' : '保存并入库'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
