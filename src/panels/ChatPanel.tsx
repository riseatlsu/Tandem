import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { logEvent } from '../study/logger';
import { useApp, type ChatMsg } from '../store';
import { Markdown } from '../ui/Markdown';
import { Icon } from '../ui/icons';
import { activeModel, agentFeatures, agentMode, decideProposal, previewProposal, sendToAgent, stopAgent } from '../agent/controller';
import { BlockPicture, ClipView, PlanCard, PlanPin, VisualModal } from './ChatVisuals';
import { onGhost } from '../view/ghost';
import { CONFIG } from '../config';
import { BlocksPreview } from '../blocks/BlocksPreview';

const DiffModal = lazy(() => import('../editor/DiffModal'));
const TOOL_LABEL: Record<string, string> = {
  read_task: 'Reading the task', read_program: 'Reading your program', read_sim_state: 'Looking at the robot', read_last_run: 'Checking the last run',
  search_docs: 'Searching the docs', dry_run: 'Testing a program in a hidden copy of the cell', propose_patch: 'Preparing a suggestion',
  show_blocks: 'Drawing the blocks', show_example: 'Finding an example', make_plan: 'Making a plan', preview_proposal: 'Playing a ghost preview',
};
function suggestions() {
  const f = agentFeatures();
  return [
    f.plans ? 'Make me a plan for this task' : 'What should I do first?',
    f.visuals ? 'Show me how to teach a position' : 'Explain joint moves vs. straight-line moves',
    'Why did my program stop?',
    agentMode() === 'suggest' ? 'Help me build this program' : 'Which blocks do I need?',
  ];
}

const POS_KEY = 'tandem.agentPos';
type Pos = { right: number; bottom: number };
function loadPos(): Pos {
  try { const p = JSON.parse(localStorage.getItem(POS_KEY) ?? 'null'); if (p && typeof p.right === 'number' && typeof p.bottom === 'number') return p; } catch { /* storage unavailable */ }
  const pw = (document.querySelector('.pendant') as HTMLElement | null)?.offsetWidth ?? 540;
  return { right: pw + 40, bottom: 84 };
}
function savePos(p: Pos) { try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch { /* storage unavailable */ } }

export function setAgentOpen(open: boolean) {
  if (useApp.getState().agentOpen === open) return;
  useApp.getState().set({ agentOpen: open });
  logEvent('panel_toggle', { agent: open ? 'open' : 'collapsed' });
}

/** Collapsed AI partner: lives in the pendant's status bar, so it is always one tap away. */
export function AgentButton() {
  const open = useApp((s) => s.agentOpen);
  const busy = useApp((s) => s.agentBusy);
  const replies = useApp((s) => (s.chats[s.taskId] ?? []).filter((m) => m.role === 'assistant' || m.role === 'proposal').length);
  const [seen, setSeen] = useState(replies);
  useEffect(() => { if (open) setSeen(replies); }, [open, replies]);
  const unread = !open && replies > seen;
  return (
    <button data-tour="agent-btn" className={`agent-btn ${open ? 'on' : ''} ${busy ? 'busy' : ''}`} aria-pressed={open} aria-label={open ? 'Hide AI partner' : 'Open AI partner'}
      title={open ? 'Hide the AI partner' : 'Open the AI partner'} onClick={() => setAgentOpen(!open)}>
      <span className="agent-orb" /> AI Partner
      {unread && <i className="badge" aria-label="New reply" />}
    </button>
  );
}

/** Expanded AI partner: a floating window you can drag anywhere. Its bottom-right corner is remembered. */
export function AgentDock() {
  const open = useApp((s) => s.agentOpen);
  const [pos, setPos] = useState<Pos>(loadPos);
  useEffect(() => {
    const fit = () => setPos((p) => ({ right: Math.min(Math.max(8, p.right), innerWidth - 200), bottom: Math.min(Math.max(8, p.bottom), innerHeight - 120) }));
    addEventListener('resize', fit); fit();
    return () => removeEventListener('resize', fit);
  }, []);
  const drag = useRef<{ x: number; y: number; start: Pos } | null>(null);
  if (!open) return null;
  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, select, textarea, input')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, start: pos };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const el = e.currentTarget.closest('.agent-float') as HTMLElement;
    const w = el?.offsetWidth ?? 380, h = el?.offsetHeight ?? 500;
    setPos({ right: Math.min(Math.max(8, d.start.right - (e.clientX - d.x)), innerWidth - w - 8), bottom: Math.min(Math.max(8, d.start.bottom - (e.clientY - d.y)), innerHeight - h - 8) });
  };
  const onUp = () => { if (drag.current) savePos(pos); drag.current = null; };
  return (
    <div className="agent-float" style={{ right: pos.right, bottom: pos.bottom }}>
      <ChatPanel dragProps={{ onPointerDown: onDown, onPointerMove: onMove, onPointerUp: onUp }} onCollapse={() => setAgentOpen(false)} />
    </div>
  );
}

type DragProps = { onPointerDown: (e: React.PointerEvent) => void; onPointerMove: (e: React.PointerEvent) => void; onPointerUp: () => void };
export function ChatPanel({ dragProps, onCollapse }: { dragProps: DragProps; onCollapse: () => void }) {
  const taskId = useApp((s) => s.taskId);
  const msgs = useApp((s) => s.chats[s.taskId]) ?? [];
  const busy = useApp((s) => s.agentBusy);
  const mode = useApp((s) => s.mode);
  const demoModel = useApp((s) => s.demoModel);
  const set = useApp((s) => s.set);
  const [text, setText] = useState('');
  const [diffFor, setDiffFor] = useState<ChatMsg | null>(null);
  const [blocksFor, setBlocksFor] = useState<ChatMsg | null>(null);
  const [bigVisual, setBigVisual] = useState<ChatMsg['visual'] | null>(null);
  const [ghosting, setGhosting] = useState(false);
  useEffect(() => onGhost((c) => setGhosting(!!c)), []);
  const canPreview = agentFeatures().preview;
  const scroll = useRef<HTMLDivElement>(null);
  const am = agentMode();
  useEffect(() => { scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: 'smooth' }); }, [msgs.length, msgs[msgs.length - 1]?.text]);
  void taskId;

  const send = (t = text) => { if (!t.trim() || busy) return; setText(''); void sendToAgent(t.trim()); };

  return (
    <section className="glass panel agent-window" aria-label="AI partner">
      <div className="panel-head agent-head" {...dragProps} title="Drag to move">
        <span className="agent-orb" style={{ width: 22, height: 22, margin: 0 }} />
        <span style={{ fontWeight: 650 }}>AI Partner</span>
        {am === 'qa' && <span className="chip" title="This session’s partner explains but does not edit">Q&amp;A</span>}
        <span className="spacer" />
        {mode === 'demo' ? (
          <select className="field" style={{ height: 26, fontSize: 12 }} value={demoModel} onChange={(e) => set({ demoModel: e.target.value })} aria-label="Model">
            {CONFIG.demoModels.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        ) : <span className="chip" title="Model set by the study">{activeModel()}</span>}
        <button className="icon-btn" onClick={onCollapse} aria-label="Collapse AI partner" title="Collapse"><Icon.minus /></button>
      </div>
      <div className="chat">
        {agentFeatures().plans && <PlanPin />}
        <div className="chat-scroll" ref={scroll} aria-live="polite">
          {msgs.length === 0 && (
            <div className="agent-empty">
              <div className="agent-orb" />
              <div style={{ fontWeight: 650, color: 'var(--ink)', fontSize: 15 }}>Your programming partner</div>
              <div style={{ marginTop: 4 }}>{am === 'suggest' ? 'Ask anything about the robot or your program. I can test changes in a hidden copy of the cell and suggest edits for you to accept.' : 'Ask anything about the robot or your program — I’ll explain and point you in the right direction.'}</div>
              <div className="suggestions">{suggestions().map((s) => <button key={s} onClick={() => send(s)}>{s}</button>)}</div>
            </div>
          )}
          {msgs.map((m) => {
            if (m.role === 'user') return <div key={m.id} className="msg user">{m.text}</div>;
            if (m.role === 'assistant') return <div key={m.id} className="msg assistant"><Markdown text={m.text || '…'} /></div>;
            if (m.role === 'error') return <div key={m.id} className="msg assistant" style={{ borderColor: 'rgba(239,75,95,.35)', color: '#8f1527' }}>{m.text}</div>;
            if (m.role === 'visual' && m.visual) return (
              <div key={m.id} className="msg assistant visual">
                {m.visual.kind === 'blocks' ? <BlockPicture json={m.visual.json} caption={m.visual.caption} onOpen={() => setBigVisual(m.visual)} />
                  : <ClipView clip={m.visual.clip} caption={m.visual.caption} onOpen={() => setBigVisual(m.visual)} />}
              </div>
            );
            if (m.role === 'plan' && m.planId) return <PlanCard key={m.id} planId={m.planId} />;
            if (m.role === 'tool') return (
              <div key={m.id} className="tool-pill">{m.tool?.status === 'running' ? <span className="spin" /> : m.tool?.status === 'error' ? <Icon.x width={11} height={11} /> : <Icon.check width={11} height={11} />}{TOOL_LABEL[m.tool?.name ?? ''] ?? m.tool?.name}</div>
            );
            const p = m.proposal!;
            return (
              <div key={m.id} className={`proposal ${p.status}`}>
                <h4><Icon.sparkle width={14} height={14} /> Suggested {p.kind === 'blocks' ? 'blocks' : 'code change'}
                  {p.dryRun && <span className={`chip ${p.dryRun.outcome === 'completed' && p.dryRun.passed === p.dryRun.total ? 'leaf' : 'amber'}`} style={{ marginLeft: 'auto', height: 20, fontSize: 11 }}>
                    test run: {p.dryRun.outcome === 'completed' ? `${p.dryRun.passed}/${p.dryRun.total} goals` : p.dryRun.outcome}</span>}
                </h4>
                <p className="why">{p.explanation}</p>
                {p.status === 'pending' ? (
                  <div className="row wrap">
                    <button className="btn sm" onClick={() => (p.kind === 'code' ? setDiffFor(m) : setBlocksFor(m))}><Icon.eye width={13} height={13} /> Preview</button>
                    {canPreview && <button className="btn sm" disabled={ghosting} title="Watch a ghost robot run this from where the robot is now" onClick={() => void previewProposal(p, 'user')}><Icon.play width={11} height={11} /> {ghosting ? 'Playing…' : 'Show me'}</button>}
                    <span className="grow" />
                    <button className="btn sm ghost" onClick={() => decideProposal(m.id, 'rejected')}>Reject</button>
                    <button className="btn sm aqua" onClick={() => decideProposal(m.id, 'accepted')}><Icon.check width={12} height={12} /> Accept</button>
                  </div>
                ) : <div className="muted" style={{ fontWeight: 600 }}>{p.status === 'rejected' ? 'Rejected' : p.status === 'edited' ? 'Edited and applied' : 'Applied to your program'}</div>}
              </div>
            );
          })}
          {/* the model also thinks between tool calls: keep showing it until text streams in */}
          {busy && !msgs.some((m) => m.role === 'tool' && m.tool?.status === 'running') && msgs[msgs.length - 1]?.role !== 'assistant' && <div className="tool-pill"><span className="spin" /> Thinking</div>}
        </div>
        <div className="chat-input">
          <div className="box">
            <textarea rows={1} value={text} placeholder={am === 'suggest' ? 'Ask, or say “help me pick the part”…' : 'Ask a question…'} aria-label="Message the AI partner"
              onChange={(e) => { setText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(140, e.target.scrollHeight) + 'px'; }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
            {busy ? <button className="send" style={{ background: 'linear-gradient(180deg,#ff8a98,#d63047)' }} onClick={stopAgent} aria-label="Stop"><Icon.stop width={12} height={12} /></button>
              : <button className="send" disabled={!text.trim()} onClick={() => send()} aria-label="Send"><Icon.send width={15} height={15} /></button>}
          </div>
        </div>
      </div>
      {diffFor && createPortal(
        <Suspense fallback={null}>
          <DiffModal proposal={diffFor.proposal!} onClose={() => setDiffFor(null)}
            onAccept={(edited) => { decideProposal(diffFor.id, edited !== undefined ? 'edited' : 'accepted', edited); setDiffFor(null); }}
            onReject={() => { decideProposal(diffFor.id, 'rejected'); setDiffFor(null); }} />
        </Suspense>, document.body,
      )}
      {bigVisual && <VisualModal visual={bigVisual} onClose={() => setBigVisual(null)} />}
      {blocksFor && createPortal(
        <BlocksPreview json={blocksFor.proposal!.blocksJson!} onClose={() => setBlocksFor(null)}
          onAccept={() => { decideProposal(blocksFor.id, 'accepted'); setBlocksFor(null); }}
          onReject={() => { decideProposal(blocksFor.id, 'rejected'); setBlocksFor(null); }} />, document.body,
      )}
    </section>
  );
}

export function askAboutFault() {
  const f = useApp.getState().fault;
  if (!f) return;
  setAgentOpen(true);
  void sendToAgent(`My program stopped with ${f.code}${f.line ? ` at line ${f.line}` : ''}: “${f.message}”. What went wrong and how do I fix it?`);
}
