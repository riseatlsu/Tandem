import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { useApp, type ChatMsg } from '../store';
import { Markdown } from '../ui/Markdown';
import { Icon } from '../ui/icons';
import { activeModel, agentMode, decideProposal, sendToAgent, stopAgent } from '../agent/controller';
import { CONFIG } from '../config';
import { BlocksPreview } from '../blocks/BlocksPreview';

const DiffModal = lazy(() => import('../editor/DiffModal'));
const TOOL_LABEL: Record<string, string> = {
  read_task: 'Reading the task', read_program: 'Reading your program', read_sim_state: 'Looking at the robot', read_last_run: 'Checking the last run',
  search_docs: 'Searching the docs', dry_run: 'Testing a program in a hidden copy of the cell', propose_patch: 'Preparing a suggestion',
};
const SUGGESTIONS = ['What should I do first?', 'Explain joint moves vs. straight-line moves', 'Why did my program stop?', 'Help me build this program'];

export function ChatPanel() {
  const taskId = useApp((s) => s.taskId);
  const msgs = useApp((s) => s.chats[s.taskId]) ?? [];
  const busy = useApp((s) => s.agentBusy);
  const mode = useApp((s) => s.mode);
  const demoModel = useApp((s) => s.demoModel);
  const set = useApp((s) => s.set);
  const [text, setText] = useState('');
  const [diffFor, setDiffFor] = useState<ChatMsg | null>(null);
  const [blocksFor, setBlocksFor] = useState<ChatMsg | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const am = agentMode();
  useEffect(() => { scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: 'smooth' }); }, [msgs.length, msgs[msgs.length - 1]?.text]);
  void taskId;

  const send = (t = text) => { if (!t.trim() || busy) return; setText(''); void sendToAgent(t.trim()); };

  return (
    <section className="glass panel" style={{ height: '100%' }} aria-label="AI partner">
      <div className="panel-head" style={{ textTransform: 'none', letterSpacing: 0, fontSize: 13.5, color: 'var(--ink)' }}>
        <span className="agent-orb" style={{ width: 22, height: 22, margin: 0 }} />
        <span style={{ fontWeight: 650 }}>AI Partner</span>
        {am === 'qa' && <span className="chip" title="This session’s partner explains but does not edit">Q&amp;A</span>}
        <span className="spacer" />
        {mode === 'demo' ? (
          <select className="field" style={{ height: 26, fontSize: 12 }} value={demoModel} onChange={(e) => set({ demoModel: e.target.value })} aria-label="Model">
            {CONFIG.demoModels.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        ) : <span className="chip" title="Model set by the study">{activeModel()}</span>}
      </div>
      <div className="chat">
        <div className="chat-scroll" ref={scroll} aria-live="polite">
          {msgs.length === 0 && (
            <div className="agent-empty">
              <div className="agent-orb" />
              <div style={{ fontWeight: 650, color: 'var(--ink)', fontSize: 15 }}>Your programming partner</div>
              <div style={{ marginTop: 4 }}>{am === 'suggest' ? 'Ask anything about the robot or your program. I can test changes in a hidden copy of the cell and suggest edits for you to accept.' : 'Ask anything about the robot or your program — I’ll explain and point you in the right direction.'}</div>
              <div className="suggestions">{SUGGESTIONS.map((s) => <button key={s} onClick={() => send(s)}>{s}</button>)}</div>
            </div>
          )}
          {msgs.map((m) => {
            if (m.role === 'user') return <div key={m.id} className="msg user">{m.text}</div>;
            if (m.role === 'assistant') return <div key={m.id} className="msg assistant"><Markdown text={m.text || '…'} /></div>;
            if (m.role === 'error') return <div key={m.id} className="msg assistant" style={{ borderColor: 'rgba(239,75,95,.35)', color: '#8f1527' }}>{m.text}</div>;
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
                    <span className="grow" />
                    <button className="btn sm ghost" onClick={() => decideProposal(m.id, 'rejected')}>Reject</button>
                    <button className="btn sm aqua" onClick={() => decideProposal(m.id, 'accepted')}><Icon.check width={12} height={12} /> Accept</button>
                  </div>
                ) : <div className="muted" style={{ fontWeight: 600 }}>{p.status === 'rejected' ? 'Rejected' : p.status === 'edited' ? 'Edited and applied' : 'Applied to your program'}</div>}
              </div>
            );
          })}
          {busy && !msgs.some((m) => m.role === 'tool' && m.tool?.status === 'running') && msgs[msgs.length - 1]?.role === 'user' && <div className="tool-pill"><span className="spin" /> Thinking</div>}
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
      {diffFor && (
        <Suspense fallback={null}>
          <DiffModal proposal={diffFor.proposal!} onClose={() => setDiffFor(null)}
            onAccept={(edited) => { decideProposal(diffFor.id, edited !== undefined ? 'edited' : 'accepted', edited); setDiffFor(null); }}
            onReject={() => { decideProposal(diffFor.id, 'rejected'); setDiffFor(null); }} />
        </Suspense>
      )}
      {blocksFor && (
        <BlocksPreview json={blocksFor.proposal!.blocksJson!} onClose={() => setBlocksFor(null)}
          onAccept={() => { decideProposal(blocksFor.id, 'accepted'); setBlocksFor(null); }}
          onReject={() => { decideProposal(blocksFor.id, 'rejected'); setBlocksFor(null); }} />
      )}
    </section>
  );
}

export function askAboutFault() {
  const f = useApp.getState().fault;
  if (!f) return;
  void sendToAgent(`My program stopped with ${f.code}${f.line ? ` at line ${f.line}` : ''}: “${f.message}”. What went wrong and how do I fix it?`);
}
