import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../store';
import { TASKS, DEMO_TASKS } from '../content';
import { host } from '../simHost';
import { Icon } from '../ui/icons';
import { advanceTask } from '../study/session';
import { SoundToggles } from '../ui/SoundToggles';

const BASE = import.meta.env.BASE_URL;
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function Topbar() {
  const mode = useApp((s) => s.mode);
  const study = useApp((s) => s.study);
  const taskId = useApp((s) => s.taskId);
  const taskIndex = useApp((s) => s.taskIndex);
  const passed = useApp((s) => s.passed);
  const timeLeft = useApp((s) => s.timeLeftSec);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const task = TASKS[taskId];

  useEffect(() => {
    if (mode !== 'study' || timeLeft == null) return;
    const id = setInterval(() => {
      const t = useApp.getState().timeLeftSec;
      if (t == null || useApp.getState().tour) return; // the tour is untimed
      if (t <= 1) { useApp.getState().set({ timeLeftSec: 0 }); void advanceTask('timeout'); }
      else useApp.getState().set({ timeLeftSec: t - 1 });
    }, 1000);
    return () => clearInterval(id);
  }, [mode, timeLeft == null, taskId]);

  return (
    <header className="glass topbar">
      {mode === 'demo' ? (
        <a className="brand" href={BASE} title="Back to the Tandem home page">
          <img src={`${BASE}logo.png`} alt="" />
          <div><div className="word">Tandem</div><div className="tag">Program cobots, together</div></div>
        </a>
      ) : (
        <div className="brand">
          <img src={`${BASE}logo.png`} alt="" />
          <div><div className="word">Tandem</div><div className="tag">Program cobots, together</div></div>
        </div>
      )}
      <div className="center">
        {mode === 'study' && study ? (
          <div className="tracker" role="group" aria-label="Task progress">
            <Bubbles ids={study.taskSequence} current={taskId} passed={passed} />
            <span className="tracker-text"><span className="muted">Task {taskIndex + 1} of {study.taskSequence.length}</span><span className="title">{task?.title}</span></span>
            {timeLeft != null && <span className={`chip ${timeLeft < 60 ? 'rose' : ''}`}><Icon.timer width={13} height={13} />{fmt(timeLeft)}</span>}
            {passed[taskId] ? (
              <button className="btn sm leaf" onClick={() => void advanceTask('pass')}>{taskIndex + 1 === study.taskSequence.length ? 'Finish' : 'Next task'} <Icon.chevron width={12} height={12} /></button>
            ) : (
              <button className="btn sm ghost" onClick={() => setConfirmSkip(true)}><Icon.skip width={12} height={12} /> Skip</button>
            )}
          </div>
        ) : (
          <div className="tracker" role="group" aria-label="Choose task">
            <Bubbles ids={DEMO_TASKS} current={taskId} passed={passed} onPick={(t) => { if (t !== taskId) host.loadTask(t); }} />
            <span className="tracker-text"><span className="title">{task?.title}</span></span>
          </div>
        )}
      </div>
      <div className="row">
        <SoundToggles />
        {mode === 'study'
          ? <span className="chip aqua"><span className="dot" />Study · {study?.code}</span>
          : <span className="chip leaf"><span className="dot" />Demo</span>}
      </div>
      {confirmSkip && createPortal(
        <div className="modal-back" onClick={() => setConfirmSkip(false)}>
          <div className="glass modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Skip task">
            <div className="modal-head">Skip this task?</div>
            <div className="modal-body">You won’t be able to come back to “{task?.title}”. That’s completely okay — skipping is part of the study.</div>
            <div className="modal-foot"><button className="btn" onClick={() => setConfirmSkip(false)}>Keep working</button><button className="btn aqua" onClick={() => { setConfirmSkip(false); void advanceTask('skip'); }}>Skip task</button></div>
          </div>
        </div>, document.body,
      )}
    </header>
  );
}

/** Level-tracker bubbles: light blue = current task, green = finished, glossy glass = not yet. */
function Bubbles({ ids, current, passed, onPick }: { ids: string[]; current: string; passed: Record<string, boolean>; onPick?: (id: string) => void }) {
  return (
    <ol className="bubbles">
      {ids.map((id, i) => {
        const state = id === current ? 'cur' : passed[id] ? 'done' : '';
        const label = `Task ${i + 1}: ${TASKS[id]?.title ?? id}${passed[id] ? ' (done)' : ''}`;
        return (
          <li key={id} className={state}>
            {onPick ? (
              <button className={`bubble ${state} ${passed[id] ? 'passed' : ''}`} aria-label={label} title={label} aria-current={id === current ? 'step' : undefined} onClick={() => onPick(id)}>
                {passed[id] && id !== current ? <Icon.check width={13} height={13} /> : <span>{i + 1}</span>}
              </button>
            ) : (
              <span className={`bubble ${state} ${passed[id] ? 'passed' : ''}`} aria-label={label} title={label} aria-current={id === current ? 'step' : undefined}>
                {passed[id] && id !== current ? <Icon.check width={13} height={13} /> : <span>{i + 1}</span>}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
