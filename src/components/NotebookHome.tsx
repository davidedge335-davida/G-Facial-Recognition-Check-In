import React, { useEffect, useState } from 'react';
import { ArrowRight, BookOpen, Camera, Check, Flower2, HelpCircle, Leaf, Settings, Smile } from 'lucide-react';
import { CameraView } from './CameraView';
import { PersonAvatar } from './PersonAvatar';
import { CheckinLog, PersonRecord } from '../types';

interface NotebookHomeProps {
  persons: PersonRecord[];
  logs: CheckinLog[];
  isProcessing: boolean;
  isResultOpen: boolean;
  statusText: string;
  hasError: boolean;
  onCaptureFrame: (frameBase64: string, imageData: ImageData) => void;
  onSimulateCheckin: (person: PersonRecord) => void;
  onOpenGuide: () => void;
  onOpenAdmin: () => void;
}

/** 首页只组织视觉与真实统计；识别、持久化和路由仍由 App 管理。 */
export function NotebookHome(props: NotebookHomeProps) {
  const [today, setToday] = useState(() => new Date());
  useEffect(() => {
    // 持续打开的签到终端也能在跨日后更新日期与今日人数。
    const timer = window.setInterval(() => setToday(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const todayCount = new Set(props.logs
    .filter(log => new Date(log.checkinTime).toDateString() === today.toDateString())
    .map(log => log.userId)).size;
  const month = today.toLocaleDateString('en', { month: 'short' }).toUpperCase();
  const weekday = today.toLocaleDateString('zh-CN', { weekday: 'long' });

  return (
    <div className="journal-home">
      <a className="skip-link" href="#checkin-workspace">跳到签到区域</a>
      <header className="journal-masthead">
        <a className="journal-brand" href="/" aria-label="日日签到首页">
          <span className="brand-mark"><BookOpen size={23} strokeWidth={1.5} /></span>
          <span><strong>日日签到</strong><small>THE DAILY JOURNAL</small></span>
        </a>
        <p className="masthead-note">把平凡的一天，认真记下。</p>
        <button id="goto-admin-footer-btn" onClick={props.onOpenAdmin} className="journal-link">
          <Settings size={16} /><span>管理手帐</span><ArrowRight size={14} />
        </button>
      </header>

      <main id="checkin-workspace" className="journal-main" tabIndex={-1}>
        <section className="notebook-spread" aria-labelledby="journal-title">
          {/* 装订环与胶带均为纯 CSS 装饰，屏幕阅读器不重复朗读。 */}
          <div className="notebook-binding" aria-hidden="true">
            {Array.from({ length: 8 }, (_, index) => <i key={index} />)}
          </div>
          <div className="spread-meta">
            <span><span className="small-dot" /> DAILY ATTENDANCE</span>
            <span>きょうの記録 <span className="meta-divider">/</span> VOL. 01</span>
          </div>

          <div className="notebook-columns">
            <div className="journal-intro">
              <div className="intro-topline">
                <span className="journal-eyebrow">每一次见面，都值得记录</span>
                <div className="date-stamp" aria-label={today.toLocaleDateString('zh-CN', { dateStyle: 'full' })}>
                  <span>{month} {today.getFullYear()}</span>
                  <strong>{String(today.getDate()).padStart(2, '0')}</strong>
                  <span>{weekday}</span>
                </div>
              </div>
              <h1 id="journal-title">今日露脸<br /><span>签到册</span><span className="title-flower" aria-hidden="true"><Flower2 /></span></h1>
              <p className="handwritten-note" aria-hidden="true">a little smile, a lovely day.</p>
              <p className="intro-description">在忙碌开始之前，留一个微笑。<br />对准镜头，把今天的到来轻轻记下。</p>

              <ol className="journal-steps" aria-label="签到步骤">
                <li><span className="step-number">01</span><Camera size={17} /><span>允许摄像头访问</span></li>
                <li><span className="step-number">02</span><Smile size={17} /><span>面向镜头，保持自然</span></li>
                <li><span className="step-number">03</span><Check size={17} /><span>等待识别，完成签到</span></li>
              </ol>

              <div className="journal-tally">
                <div><span>已录入人员</span><strong>{String(props.persons.length).padStart(2, '0')}<small>人</small></strong></div>
                <div><span>今日已签到</span><strong>{String(todayCount).padStart(2, '0')}<small>人</small></strong></div>
                <Leaf className="tally-leaf" size={35} strokeWidth={1.2} aria-hidden="true" />
              </div>
              <p className="intro-footnote">一日一页，慢慢积累。<span aria-hidden="true">✳</span></p>
            </div>

            <div className="journal-camera-page">
              <div className="camera-page-heading"><span>01 / 留下今日的微笑</span><span className="camera-page-caption">SAY CHEESE!</span></div>
              <CameraView
                onCaptureFrame={props.onCaptureFrame}
                isProcessing={props.isProcessing}
                isPaused={props.isResultOpen}
                statusText={props.statusText}
                hasError={props.hasError}
              />
              <button id="open-guide-btn" onClick={props.onOpenGuide} className="camera-help journal-link">
                <HelpCircle size={15} /><span>摄像头打不开？看看使用小贴士</span><ArrowRight size={14} />
              </button>
            </div>
          </div>
          <div className="spread-footer"><span>MEMORIES OF EVERY DAY</span><span>好好见面 · 好好记录</span><span>— 01 —</span></div>
        </section>

        <section className="demo-album" aria-labelledby="demo-title">
          <div className="album-intro">
            <span className="journal-eyebrow">TRY A LITTLE DEMO</span>
            <h2 id="demo-title">先来体验一下？</h2>
            <p>点击一张相片，体验签到流程。<br />无需摄像头，模拟记录会保存到本机。</p>
            <span className="album-arrow" aria-hidden="true">翻开今日的小相册 <ArrowRight size={15} /></span>
          </div>
          {props.persons.length > 0 ? (
            <div className="album-photos">
              {props.persons.slice(0, 3).map((person, index) => (
                <button key={person.id} disabled={props.isProcessing} onClick={() => props.onSimulateCheckin(person)} className="album-photo polaroid-card" aria-label={`模拟 ${person.name} 签到`}>
                  <span className={`photo-tape photo-tape-${index}`} aria-hidden="true" />
                  <PersonAvatar src={person.avatarUrl} name={person.name} className="album-avatar" />
                  <strong>{person.name}</strong><span className="photo-caption">体验签到 <ArrowRight size={12} /></span>
                </button>
              ))}
            </div>
          ) : (
            <div className="album-empty"><BookOpen size={26} /><p>相册还是空白的，先录入一位新朋友吧。</p><button className="journal-link" onClick={props.onOpenAdmin}>前往人员管理 <ArrowRight size={15} /></button></div>
          )}
        </section>
      </main>
      <footer className="journal-footer"><span><Flower2 size={15} /> 日日签到 · 每个平凡的今天</span><span>InsightFace × 飞书妙搭</span></footer>
    </div>
  );
}
