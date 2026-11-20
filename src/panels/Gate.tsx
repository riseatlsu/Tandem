import { useEffect, useState } from 'react';
import { redeem, startDemo } from '../study/session';
import { useApp } from '../store';

const BASE = import.meta.env.BASE_URL;
export function Gate({ initialCode, onDone }: { initialCode: string; onDone(): void }) {
  const [code, setCode] = useState(initialCode);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async (c = code) => {
    if (!c.trim()) return;
    setBusy(true); setErr('');
    try { await redeem(c); onDone(); }
    catch (e) { setErr((e as Error).message || 'That code did not work.'); }
    finally { setBusy(false); }
  };
  useEffect(() => { if (initialCode) void go(initialCode); }, []);  
  return (
    <div className="gate">
      <div className="glass gate-card">
        <img src={`${BASE}logo.svg`} alt="Tandem logo" />
        <h1>Tandem</h1>
        <p>Welcome to the study. Enter the participant code you were given.</p>
        <form onSubmit={(e) => { e.preventDefault(); void go(); }} className="stack">
          <input className="field code-input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXX-XXXX" autoFocus aria-label="Participant code" />
          {err && <div className="chip rose" style={{ justifySelf: 'center', height: 'auto', padding: '6px 12px', whiteSpace: 'normal' }}>{err}</div>}
          <button className="btn aqua lg" disabled={busy || !code.trim()} type="submit">{busy ? 'Checking…' : 'Start'}</button>
        </form>
        <button className="btn ghost sm" style={{ marginTop: 14 }} onClick={() => { const u = new URL(location.href); u.searchParams.delete('study'); u.searchParams.delete('code'); history.replaceState(null, '', u); useApp.getState().set({ mode: 'demo' }); startDemo(); onDone(); }}>Just exploring? Open the demo</button>
      </div>
    </div>
  );
}
