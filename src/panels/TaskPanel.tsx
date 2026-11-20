import { useApp } from '../store';
import { TASKS } from '../content';
import { Markdown } from '../ui/Markdown';
import { Icon } from '../ui/icons';
import { useState } from 'react';

export function TaskPanel() {
  const taskId = useApp((s) => s.taskId);
  const preds = useApp((s) => s.predicates);
  const task = TASKS[taskId];
  const [hint, setHint] = useState(-1);
  if (!task) return null;
  const done = preds.filter((p) => p.pass).length;
  return (
    <section className="glass panel" style={{ flex: '0 1 auto', maxHeight: '46%' }} aria-label="Task">
      <div className="panel-head">Task<span className="spacer" /><span className={`chip ${done === preds.length && preds.length ? 'leaf' : ''}`}>{done}/{preds.length} goals</span></div>
      <div className="panel-body stack">
        <div>
          <div style={{ fontWeight: 650, fontSize: 15, marginBottom: 4, letterSpacing: '-0.01em' }}>{task.title}</div>
          <div className="brief"><Markdown text={task.brief} /></div>
        </div>
        <ul className="checklist" aria-label="Goals">
          {preds.map((p, i) => (
            <li key={i} className={p.pass ? 'pass' : ''}>
              <span className="check">{p.pass && <Icon.check width={11} height={11} />}</span>
              <span>{p.label}</span>
              {p.detail && <span className="detail">{p.detail}</span>}
            </li>
          ))}
        </ul>
        {task.hints?.length ? (
          <div>
            {hint >= 0 && <div className="brief" style={{ padding: '8px 10px', borderRadius: 10, background: 'rgba(26,140,255,.07)', marginBottom: 6 }}>{task.hints[hint]}</div>}
            {hint < task.hints.length - 1 && <button className="btn sm ghost" onClick={() => setHint(hint + 1)}><Icon.info /> {hint < 0 ? 'Show a hint' : 'Another hint'}</button>}
          </div>
        ) : null}
      </div>
    </section>
  );
}
