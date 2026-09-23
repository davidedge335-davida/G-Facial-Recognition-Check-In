import React, { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { ArrowLeft, KeyRound, LogOut, X } from 'lucide-react';
import { NotebookHome } from './components/NotebookHome';
import { CheckinResultModal } from './components/CheckinResultModal';
import { AdminLoginView } from './components/AdminLoginView';
import { HttpsGuideModal } from './components/HttpsGuideModal';
import { PersonRecord, CheckinLog, FeishuConfigState, CheckinResultState } from './types';
import {
  INITIAL_PERSONS,
  DEFAULT_FEISHU_CONFIG,
  extractEmbeddingFromImageData,
  calculateCosineSimilarity,
  checkDuplicateCheckin
} from './utils/faceMatcher';

// 图表与后台表单仅在管理员进入后加载，缩小日常签到首页的首屏脚本。
const AdminPanel = lazy(() => import('./components/AdminPanel').then(module => ({ default: module.AdminPanel })));

export default function App() {
  // 路由状态：检测是否访问 /admin
  const [isAdminRoute, setIsAdminRoute] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const p = window.location.pathname;
    const h = window.location.hash;
    return p === '/admin' || p.startsWith('/admin/') || h === '#admin';
  });

  // 管理员账号与密码（支持本地持久化，初始账号：admin，密码：admin123）
  const [adminCreds, setAdminCreds] = useState<{ username: string; password: string }>(() => {
    const saved = localStorage.getItem('face_checkin_admin_creds');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        // fallback
      }
    }
    return { username: 'admin', password: 'admin123' };
  });

  // 管理员登录认证态（存储在 sessionStorage 中）
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return sessionStorage.getItem('face_checkin_admin_auth') === 'true';
  });

  // 修改密码弹窗
  const [isChangePwdOpen, setIsChangePwdOpen] = useState<boolean>(false);
  const [oldPasswordInput, setOldPasswordInput] = useState<string>('');
  const [newPasswordInput, setNewPasswordInput] = useState<string>('');
  const [confirmPasswordInput, setConfirmPasswordInput] = useState<string>('');
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

  // 管理员认证处理
  const handleAdminLoginSuccess = () => {
    setIsAdminAuthenticated(true);
    sessionStorage.setItem('face_checkin_admin_auth', 'true');
  };

  const handleAdminLogout = () => {
    setIsAdminAuthenticated(false);
    sessionStorage.removeItem('face_checkin_admin_auth');
  };

  // 修改密码保存
  const handleSaveNewPassword = (e: React.FormEvent) => {
    e.preventDefault();
    setChangePwdMsg({ text: '', isError: false });

    if (oldPasswordInput !== adminCreds.password) {
      setChangePwdMsg({ text: '原密码输入不正确', isError: true });
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

    const updatedCreds = { ...adminCreds, password: newPasswordInput };
    setAdminCreds(updatedCreds);
    localStorage.setItem('face_checkin_admin_creds', JSON.stringify(updatedCreds));
    setChangePwdMsg({ text: '密码修改成功，请牢记新密码！', isError: false });

    setTimeout(() => {
      setIsChangePwdOpen(false);
      setOldPasswordInput('');
      setNewPasswordInput('');
      setConfirmPasswordInput('');
      setChangePwdMsg({ text: '', isError: false });
    }, 1200);
  };

  // 底库人员数据（支持本地持久化）
  const [persons, setPersons] = useState<PersonRecord[]>(() => {
    const saved = localStorage.getItem('face_checkin_persons');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        return INITIAL_PERSONS;
      }
    }
    return INITIAL_PERSONS;
  });

  // 飞书配置
  const [feishuConfig, setFeishuConfig] = useState<FeishuConfigState>(() => {
    const saved = localStorage.getItem('face_checkin_feishu');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        return DEFAULT_FEISHU_CONFIG;
      }
    }
    return DEFAULT_FEISHU_CONFIG;
  });

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

  // HTTPS 真机说明弹窗
  const [isHttpsGuideOpen, setIsHttpsGuideOpen] = useState<boolean>(false);

  // 持久化同步
  useEffect(() => {
    localStorage.setItem('face_checkin_persons', JSON.stringify(persons));
  }, [persons]);

  useEffect(() => {
    localStorage.setItem('face_checkin_feishu', JSON.stringify(feishuConfig));
  }, [feishuConfig]);

  useEffect(() => {
    localStorage.setItem('face_checkin_logs', JSON.stringify(logs));
  }, [logs]);

  // 处理截帧识别打卡
  const handleCaptureFrame = useCallback(
    async (frameBase64: string, imageData: ImageData) => {
      if (isProcessing) return;
      setIsProcessing(true);
      setHasError(false);
      setStatusText('正在识别人脸，请稍候…');

      try {
        // 首先尝试调用后端 FastAPI /api/checkin 接口
        let matchedPerson: PersonRecord | null = null;
        let similarity = 0;
        let isRepeated = false;
        let lastTimeStr = '';
        let feishuSynced = false;
        let feishuMessage = '';

        try {
          const res = await fetch('/api/checkin', {
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
              feishuSynced = data.feishu_synced;
              feishuMessage = data.feishu_message;
            } else if (data.code === 201) {
              // 重复打卡
              isRepeated = true;
              matchedPerson = persons.find(p => p.studentId === data.user?.student_id) || null;
              similarity = data.similarity;
              feishuMessage = data.feishu_message;
            }
          }
        } catch (apiErr) {
          // 后端未运行或网络不可达时，启用浏览器端纯客户端高精度比对引擎
        }

        // 客户端本地比对回退逻辑
        if (!matchedPerson && !isRepeated) {
          const queryEmbedding = extractEmbeddingFromImageData(imageData);
          let bestScore = 0;
          let bestPerson: PersonRecord | null = null;

          for (const person of persons) {
            const score = calculateCosineSimilarity(queryEmbedding, person.embedding);
            if (score > bestScore) {
              bestScore = score;
              bestPerson = person;
            }
          }

          // 阈值 0.60
          if (bestPerson && bestScore >= 0.58) {
            matchedPerson = bestPerson;
            similarity = bestScore;

            // 客户端防重复打卡判定 (5分钟 = 300秒)
            const dup = checkDuplicateCheckin(matchedPerson.id, logs, 300);
            if (dup.isDuplicate) {
              isRepeated = true;
              lastTimeStr = dup.lastTime || '';
            }
          } else {
            similarity = bestScore;
          }
        }

        const nowStr = new Date().toLocaleString();

        if (isRepeated && matchedPerson) {
          // 防重复打卡
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
          // 签到成功，推送到飞书妙搭
          if (feishuConfig.enabled && feishuConfig.webhookUrl) {
            try {
              const feishuPayload = {
                event: 'face_checkin_success',
                timestamp: nowStr,
                data: {
                  name: matchedPerson.name,
                  student_id: matchedPerson.studentId,
                  department: matchedPerson.department,
                  similarity: Number((similarity * 100).toFixed(1)),
                  checkin_time: nowStr
                }
              };

              await fetch(feishuConfig.webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(feishuPayload),
                mode: 'no-cors'
              });
              feishuSynced = true;
              feishuMessage = '成功推送至飞书妙搭';
            } catch (e) {
              feishuSynced = false;
              feishuMessage = '飞书网络推送异常';
            }
          }

          // 写入本地流水
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

          setStatusText(`签到成功：${matchedPerson.name}`);
          setCheckinResult({
            status: 'success',
            message: feishuSynced ? '签到已完成，记录已同步到飞书。' : '签到已完成，记录已保存在本机。',
            user: matchedPerson,
            similarity,
            checkinTime: nowStr,
            isRepeated: false,
            feishuSynced,
            feishuMsg: feishuMessage
          });
        } else {
          // 未匹配到人员
          setHasError(true);
          setStatusText('未匹配到人员，请联系管理员录入照片');
          setCheckinResult({
            status: 'not_found',
            message: '还没有找到你的记录。请调整光线并重试，或联系管理员录入照片。',
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
    [isProcessing, persons, logs, feishuConfig]
  );

  // 快捷模拟某个底库人员进行签到测试（方便无法开摄像头或没有对应人脸时快速体验）
  const handleSimulateCheckin = (person: PersonRecord) => {
    if (isProcessing) return;
    setIsProcessing(true);
    setStatusText(`正在比对底库特征 [${person.name}]...`);

    setTimeout(() => {
      const nowStr = new Date().toLocaleString();
      // 防重检查
      const dup = checkDuplicateCheckin(person.id, logs, 300);
      if (dup.isDuplicate) {
        setIsProcessing(false);
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
        // 体验按钮没有发送请求，不能显示为已经同步飞书。
        feishuStatus: 'LOCAL_SAVED'
      };
      setLogs(prev => [newLog, ...prev]);

      setIsProcessing(false);
      setCheckinResult({
        status: 'success',
        message: '这是一条模拟签到，体验记录已保存在本机。',
        user: person,
        similarity: 0.965,
        checkinTime: nowStr,
        isRepeated: false,
        feishuSynced: false,
        feishuMsg: '体验记录仅保存在本机，未发送到飞书'
      });
    }, 600);
  };

  // 关闭弹窗并重置取景引导
  const handleCloseModal = useCallback(() => {
    setCheckinResult(null);
    setStatusText('请将面部对准参考框');
    setHasError(false);
  }, []);

  return (
    <div className="app-shell min-h-screen flex flex-col">
      {/* ---------------- 界面 1：刷脸签到主界面 (/) ---------------- */}
      {!isAdminRoute ? (
        <NotebookHome
          persons={persons}
          logs={logs}
          isProcessing={isProcessing}
          isResultOpen={checkinResult !== null}
          statusText={statusText}
          hasError={hasError}
          onCaptureFrame={handleCaptureFrame}
          onSimulateCheckin={handleSimulateCheckin}
          onOpenGuide={() => setIsHttpsGuideOpen(true)}
          onOpenAdmin={() => navigateTo('/admin')}
        />
      ) : (
        /* ---------------- 界面 2：管理后台独立界面 (/admin) ---------------- */
        <div className="admin-shell flex-1 flex flex-col">
          {!isAdminAuthenticated ? (
            /* 未认证：展示管理员登录页面，含初始用户名密码提示 */
            <main className="flex-1 flex items-center justify-center p-4">
              <AdminLoginView
                validUsername={adminCreds.username}
                validPassword={adminCreds.password}
                onLoginSuccess={handleAdminLoginSuccess}
                onBackToCheckin={() => navigateTo('/')}
              />
            </main>
          ) : (
            /* 已认证：展示管理后台顶部专属操作栏与管理面板 */
            <>
              {/* 后台专属顶栏 */}
              <header className="admin-topbar w-full px-4 py-4 sticky top-0 z-30">
                <div className="max-w-4xl mx-auto flex flex-wrap items-center justify-between gap-3">
                  <div className="admin-header-identity flex flex-wrap items-center gap-3">
                    <button
                      id="admin-back-to-home-btn"
                      onClick={() => navigateTo('/')}
                      className="flex items-center space-x-1.5 px-3 py-1.5 bg-[#FFFCF8] hover:bg-[#F3EFE6] text-[#4A453B] rounded-xl border border-[#D6CEC1] text-xs font-gaegu text-base transition-all active:scale-95"
                    >
                      <ArrowLeft className="w-4 h-4 text-[#B25A45]" />
                      <span>返回刷脸签到</span>
                    </button>

                    <div className="h-4 w-px bg-[#D6CEC1]" />

                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-gaegu text-xl font-bold text-[#4A453B]">
                        签到管理手帐
                      </span>
                      <span className="vintage-stamp-green text-[11px] px-2 py-0.5">
                        管理员: {adminCreds.username}
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
              <main className="admin-main flex-1 w-full mx-auto px-4 py-8 sm:px-6">
                <Suspense fallback={<div className="card p-8 text-center" role="status">正在翻开管理手帐…</div>}>
                  <AdminPanel
                    persons={persons}
                    onAddPerson={newPerson => setPersons(prev => [newPerson, ...prev])}
                  onDeletePerson={id => setPersons(prev => prev.filter(p => p.id !== id))}
                  feishuConfig={feishuConfig}
                  onUpdateFeishuConfig={cfg => setFeishuConfig(cfg)}
                  logs={logs}
                  onClearLogs={() => setLogs([])}
                  onOpenHttpsGuide={() => setIsHttpsGuideOpen(true)}
                />
                </Suspense>
              </main>

              {/* 后台页脚 */}
              <footer className="py-5 px-4 text-center text-xs text-[#746F63] border-t border-[#D6CEC1]">
                <p className="font-gaegu text-sm">管理后台 · InsightFace x 飞书妙搭 · 当前账号：{adminCreds.username}</p>
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
                  className="flex-1 stamp-button stamp-button-primary py-2 rounded-xl text-xs font-gaegu text-base font-bold"
                >
                  保存新密码
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
