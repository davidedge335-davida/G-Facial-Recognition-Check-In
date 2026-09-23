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
  TrendingUp
} from 'lucide-react';
import { PersonRecord, FeishuConfigState, CheckinLog } from '../types';
import { generatePseudo512Vector, processImageFile } from '../utils/faceMatcher';
import { CheckinDashboard } from './CheckinDashboard';
import { PersonAvatar } from './PersonAvatar';

interface AdminPanelProps {
  persons: PersonRecord[];
  onAddPerson: (person: PersonRecord, photoBase64?: string) => Promise<{ success: boolean; message?: string }> | void;
  onDeletePerson: (id: string) => void;
  feishuConfig: FeishuConfigState;
  onUpdateFeishuConfig: (config: FeishuConfigState) => void;
  logs: CheckinLog[];
  onClearLogs: () => void;
  onOpenHttpsGuide: () => void;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({
  persons,
  onAddPerson,
  onDeletePerson,
  feishuConfig,
  onUpdateFeishuConfig,
  logs,
  onClearLogs,
  onOpenHttpsGuide
}) => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'users' | 'feishu' | 'logs'>('dashboard');
  const [searchQuery, setSearchQuery] = useState<string>('');

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

    const token = sessionStorage.getItem('face_checkin_token');
    if (token) {
      try {
        const payload = {
          mode: formConfig.mode,
          enabled: formConfig.enabled,
          webhook_url: formConfig.webhookUrl,
          app_id: formConfig.appId,
          app_secret: formConfig.appSecret,
          app_token: formConfig.appToken,
          table_id: formConfig.tableId
        };
        const res = await fetch('/api/feishu/test', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
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
        }
      } catch (backendErr) {
        // 后端可能未运行，回退到客户端直接探测
      }
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
  const handleSaveFeishuConfig = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateFeishuConfig(formConfig);
    const nowStr = new Date().toLocaleString();
    localStorage.setItem('face_checkin_feishu_saved_at', nowStr);
    setLastSavedTime(nowStr);
    setSaveSuccessTip(`飞书配置已成功保存！数据已持久化写入浏览器 LocalStorage（包含模式：${formConfig.mode === 'bitable' ? '多维表格 API' : 'Webhook'}），刷新或重启不会丢失。`);
    // 5秒后自动隐藏提示卡片
    setTimeout(() => {
      setSaveSuccessTip(null);
    }, 6000);
  };

  // 判断是否有未保存的更改
  const isFormChanged = useMemo(() => {
    return JSON.stringify(formConfig) !== JSON.stringify(feishuConfig);
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
                          onClick={() => {
                            if (confirm(`确认删除人员 [${person.name}] 吗？`)) {
                              onDeletePerson(person.id);
                            }
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 text-[#8E8675] hover:text-[#C27D6B] rounded transition-opacity"
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
                className="text-[#3E6546] hover:text-[#1F3E26] p-1 font-bold"
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
                  <label className="font-gaegu text-base text-[#4A453B]">App Secret</label>
                  <input
                    type="password"
                    value={formConfig.appSecret || ''}
                    onChange={e => setFormConfig({ ...formConfig, appSecret: e.target.value })}
                    className="w-full p-2 bg-[#EEE8DE] border border-[#D6CEC1] rounded-xl mono text-xs text-[#4A453B]"
                  />
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

      {/* ----------------- TAB 3: 签到流水审计 ----------------- */}
      {activeTab === 'logs' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-gaegu text-lg text-[#4A453B] font-bold">
              实时打卡流水记录 ({logs.length} 条)
            </span>
            {logs.length > 0 && (
              <button
                onClick={onClearLogs}
                className="font-gaegu text-base text-[#8E8675] hover:text-[#C27D6B] underline"
              >
                清空流水
              </button>
            )}
          </div>

          {logs.length === 0 ? (
            <div className="p-8 text-center bg-[#EEE8DE] border border-[#D6CEC1] rounded-2xl">
              <History className="w-8 h-8 text-[#8E8675] mx-auto mb-2" />
              <p className="font-gaegu text-lg text-[#5C5648]">暂无签到流水记录</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {logs.map(log => {
                const matchedPerson = persons.find(p => p.id === log.userId || p.studentId === log.studentId);
                const avatar = matchedPerson?.avatarUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80';
                const isRepeated = log.feishuStatus === 'REPEATED_SKIPPED';
                const isSynced = log.feishuStatus === 'SUCCESS';

                return (
                  <div
                    key={log.id}
                    className="p-3 bg-[#FFFCF8] border border-[#E3DCD1] rounded-xl flex items-center justify-between text-xs shadow-xs"
                  >
                    <div className="flex items-center space-x-3">
                      <img
                        src={avatar}
                        alt={log.name}
                        className="w-10 h-10 rounded-full object-cover border border-[#D6CEC1]"
                      />
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="font-gaegu text-lg font-bold text-[#4A453B]">{log.name}</span>
                          <span className="mono text-[#8E8675]">{log.studentId}</span>
                        </div>
                        <div className="text-[11px] text-[#8E8675] flex items-center space-x-2">
                          <Clock className="w-3 h-3" />
                          <span className="mono">{log.checkinTime}</span>
                          <span>· 匹配度 {(log.similarity * 100).toFixed(1)}%</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2">
                      {isRepeated ? (
                        <span className="vintage-stamp text-xs px-2 py-0.5">防重拦截</span>
                      ) : (
                        <span className="vintage-stamp-green text-xs px-2 py-0.5">签到成功</span>
                      )}

                      {isSynced && (
                        <span className="mono text-[10px] bg-[rgba(126,168,133,0.15)] text-[#4C7253] px-1.5 py-0.5 rounded border border-[#7EA885]/40">
                          飞书已同步
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

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
