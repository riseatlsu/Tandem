import { useEffect, useState } from 'react';
import { useApp } from '../store';
import { ARMS, TASKS, TASK_ORDER } from '../content';
import { host } from '../simHost';
import { Icon } from '../ui/icons';
import { advanceTask } from '../study/session';
import { logEvent } from '../study/logger';

const BASE = import.meta.env.BASE_URL;
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function Topbar() {
  const mode = useApp((s) => s.mode);
  const study = useApp((s) => s.study);
  const taskId = useApp((s) => s.taskId);
  const taskIndex = useApp((s) => s.taskIndex);
  const passed = useApp((s) => s.passed);
  const armOverride = useApp((s) => s.armOverride);
  const timeLeft = useApp((s) => s.timeLeftSec);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const task = TASKS[taskId];

  useEffect(() => {
    if (mode !== 'study' || timeLeft == null) return;
    const id = setInterval(() => {
      const t = useApp.getState().timeLeftSec;
      if (t == null) return;
      if (t <= 1) { useApp.getState().set({ timeLeftSec: 0 }); void advanceTask('timeout'); }
      else useApp.getState().set({ timeLeftSec: t - 1 });
    }, 1000);
    return () => clearInterval(id);
  }, [mode, timeLeft == null, taskId]);

  return (
    <header className="glass topbar">
      <div className="brand">
        <img src={`${BASE}logo.svg`} alt="" />
        <div><div className="word">Tandem</div><div className="tag">Program cobots, together</div></div>
      </div>
      <div className="center">
        {mode === 'study' && study ? (
          <div className="task-pill">
            <span className="muted" style={{ fontWeight: 600 }}>Task {taskIndex + 1} of {study.taskSequence.length}</span>
            <span className="title">{task?.title}</span>
            <span className="progress-dots">{study.taskSequence.map((t, i) => <i key={t} className={passed[t] ? 'done' : i === taskIndex ? 'cur' : ''} />)}</span>
            {timeLeft != null && <span className={`chip ${timeLeft < 60 ? 'rose' : ''}`}><Icon.timer width={13} height={13} />{fmt(timeLeft)}</span>}
            {passed[taskId] ? (
              <button className="btn sm leaf" onClick={() => void advanceTask('pass')}>{taskIndex + 1 === study.taskSequence.length ? 'Finish' : 'Next task'} <Icon.chevron width={12} height={12} /></button>
            ) : (
              <button className="btn sm ghost" onClick={() => setConfirmSkip(true)}><Icon.skip width={12} height={12} /> Skip</button>
            )}
          </div>
        ) : (
          <div className="task-pill">
            <span className="muted" style={{ fontWeight: 600 }}>Task</span>
            <select className="field" style={{ height: 28, border: 0, background: 'transparent', fontWeight: 600, maxWidth: 280 }} value={taskId} aria-label="Choose task"
              onChange={(e) => host.loadTask(e.target.value)}>
              {TASK_ORDER.map((t, i) => <option key={t} value={t}>{i + 1}. {TASKS[t].title}{passed[t] ? ' ✓' : ''}</option>)}
            </select>
            <span className="muted" style={{ fontWeight: 600 }}>Arm</span>
            <select className="field" style={{ height: 28, border: 0, background: 'transparent', fontWeight: 600 }} value={armOverride ?? ''} aria-label="Choose arm"
              onChange={(e) => { host.setArm(e.target.value || null); logEvent('arm_change', { arm: e.target.value }); }}>
              <option value="">Task default ({ARMS[task?.armId ?? '']?.name.split(' (')[0]})</option>
              {Object.values(ARMS).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        )}
      </div>
      <div className="row">
        {mode === 'study' ? <span className="chip aqua"><span className="dot" />Study · {study?.code}</span> : (
          <>
            <span className="chip leaf"><span className="dot" />Demo</span>
            <button className="btn sm ghost" onClick={() => { const u = new URL(location.href); u.searchParams.set('study', '1'); location.assign(u.toString()); }}>Join a study</button>
          </>
        )}
      </div>
      {confirmSkip && (
        <div className="modal-back" onClick={() => setConfirmSkip(false)}>
          <div className="glass modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Skip task">
            <div className="modal-head">Skip this task?</div>
            <div className="modal-body">You won’t be able to come back to “{task?.title}”. That’s completely okay — skipping is part of the study.</div>
            <div className="modal-foot"><button className="btn" onClick={() => setConfirmSkip(false)}>Keep working</button><button className="btn aqua" onClick={() => { setConfirmSkip(false); void advanceTask('skip'); }}>Skip task</button></div>
          </div>
        </div>
      )}
    </header>
  );
}
