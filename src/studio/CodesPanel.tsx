/** Studio: set up the service-account key, generate participant codes + links, and see which codes are in use. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ExperimentDef } from '../content';
import { Field, Num, Text } from './fields';
import { codesStatus, generateCodes, listCodes, removeKey, saveKey, type CodeRow, type CodesStatus } from './api';
import { Icon } from '../ui/icons';

const SITE_KEY = 'tandem.studio.siteUrl';
const store = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };

function csv(rows: CodeRow[]) {
  const st = rows.some((r) => r.status);
  const cell = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [['code', 'link', 'condition', 'orderIndex', 'model', 'agentMode', ...(st ? ['status', 'firstUsedAt'] : [])].join(','),
    ...rows.map((r) => [r.code, r.link, r.condition, r.orderIndex, r.model ?? '', r.agentMode, ...(st ? [r.status, r.firstUsedAt ?? ''] : [])].map(cell).join(','))].join('\n') + '\n';
}
function download(name: string, text: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** `saved` is the experiment as it is on disk; codes always use that version, so unsaved edits block generation. */
export function CodesPanel({ exp, dirty, saved }: { exp: ExperimentDef; dirty: boolean; saved: boolean }) {
  const [status, setStatus] = useState<CodesStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [per, setPer] = useState<number | undefined>(10);
  const [site, setSite] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [fresh, setFresh] = useState<{ rows: CodeRow[]; csvPath: string } | null>(null);
  const [existing, setExisting] = useState<CodeRow[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { codesStatus().then((s) => { setStatus(s); setSite(store.get(SITE_KEY) ?? s.siteUrl); }).catch((e) => setErr(e.message)); }, []);
  useEffect(() => { setConfirm(false); }, [per, exp.id, dirty]);
  const conds = Object.keys(exp.conditions);
  const total = (per ?? 0) * conds.length;
  const target = status?.mode === 'emulator' ? 'the local emulator' : status?.projectId ?? '';
  const wrongProject = status?.mode === 'live' && status.expectedProject && status.projectId !== status.expectedProject;
  const surveyMissing = !exp.postSurveyUrl || /example\.(org|com)/.test(exp.postSurveyUrl);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setErr(null);
    try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };
  const onKey = (f: File | undefined) => f && run('key', async () => { setStatus(await saveKey(await f.text())); setExisting(null); });
  const copy = (id: string, text: string) => navigator.clipboard.writeText(text).then(() => { setCopied(id); setTimeout(() => setCopied(null), 1500); }, () => setErr('Copy failed: your browser blocked clipboard access.'));
  const setSiteUrl = (v: string) => { setSite(v); store.set(SITE_KEY, v); };
  const generate = () => run('gen', async () => {
    const r = await generateCodes(exp.id, per!, site);
    setFresh({ rows: r.rows, csvPath: r.csvPath }); setConfirm(false);
    setExisting(null);
  });
  const load = () => run('list', async () => setExisting((await listCodes(exp.id, site)).rows));

  if (!status) return <div className="st-card codes"><b>Participant codes</b>{err ? <div className="st-msg bad">{err}</div> : <p className="st-help">Checking for a key…</p>}</div>;

  return (
    <div className="st-card codes">
      <div className="row"><b>Participant codes</b><span className="grow" />
        {status.mode === 'live' && <span className="chip leaf"><Icon.check width={11} height={11} /> {status.projectId}</span>}
        {status.mode === 'emulator' && <span className="chip">Emulator (test data)</span>}
      </div>
      {err && <div className="st-msg bad">{err}</div>}

      {status.mode === 'none' ? (
        <div className="codes-setup">
          <p className="st-help">Codes are stored in your Firebase project, so Studio needs a service-account key once. It stays on this computer in <code>keys/</code>, which git ignores.</p>
          <ol className="st-help">
            <li>Open the <a href={`https://console.firebase.google.com/project/${status.expectedProject || '_'}/settings/serviceaccounts/adminsdk`} target="_blank" rel="noreferrer">Firebase console service accounts page</a>.</li>
            <li>Click <b>Generate new private key</b> and save the file.</li>
            <li>Choose that file here:</li>
          </ol>
          <div className="row">
            <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => { onKey(e.target.files?.[0]); e.target.value = ''; }} />
            <button className="btn aqua" disabled={!!busy} onClick={() => fileRef.current?.click()}>{busy === 'key' ? 'Saving…' : 'Choose key file…'}</button>
          </div>
        </div>
      ) : (
        <>
          {status.mode === 'live' && (
            <p className="st-help">Using <code>{status.keyFile}</code> ({status.account}).
              {status.removable && <> <button className="link-btn" onClick={() => run('key', async () => { setStatus(await removeKey()); setExisting(null); setFresh(null); })}>Remove key</button></>}</p>
          )}
          {wrongProject && <div className="st-msg bad">This key is for <b>{status.projectId}</b>, but the site uses <b>{status.expectedProject}</b>. Codes made with it will not work on the site.</div>}
          {!saved ? <div className="st-msg bad">Save the experiment before generating codes.</div>
            : dirty ? <div className="st-msg bad">You have unsaved changes. Save first: codes always use the saved version (v{exp.version}).</div> : null}
          {surveyMissing && saved && <div className="st-msg warn">The post-study survey URL is {exp.postSurveyUrl ? 'still a placeholder' : 'empty'}. Participants won't be sent to a survey at the end.</div>}

          <div className="codes-form">
            <Field label="Codes per condition" hint={`${conds.length} conditions (${conds.join(', ')}) → ${total} codes`}><Num min={1} max={500} value={per} onChange={setPer} /></Field>
            <Field label="Site address" hint="links are this address + ?code=…"><Text mono value={site} onChange={setSiteUrl} placeholder="https://you.github.io/Tandem/" /></Field>
          </div>
          <div className="row">
            {!confirm
              ? <button className="btn aqua" disabled={!saved || dirty || !per || per < 1 || per > 500 || !!busy} onClick={() => setConfirm(true)}><Icon.plus width={12} height={12} /> Generate {total} codes</button>
              : <>
                  <button className="btn aqua" disabled={!!busy} onClick={generate}>{busy === 'gen' ? 'Writing…' : `Confirm: add ${total} codes to ${target}`}</button>
                  <button className="btn ghost" disabled={!!busy} onClick={() => setConfirm(false)}>Cancel</button>
                </>}
            <span className="grow" />
            <button className="btn ghost" disabled={!saved || !!busy} onClick={load}>{busy === 'list' ? 'Loading…' : 'Show issued codes'}</button>
          </div>
          <p className="st-help">Each code assigns a condition and a counterbalanced task order. Hand them out in order within each condition. Generating again adds more codes and continues the order.</p>

          {fresh && <CodeTable title={`New codes (${fresh.rows.length})`} note={<>Also saved to <code>{fresh.csvPath}</code>.</>} rows={fresh.rows} copied={copied} copy={copy} onCsv={() => download(`codes-${exp.id}-new.csv`, csv(fresh.rows))} />}
          {existing && <CodeTable title={`Issued codes (${existing.length})`} note={summary(existing)} rows={existing} copied={copied} copy={copy} onCsv={() => download(`codes-${exp.id}-all.csv`, csv(existing))} />}
        </>
      )}
    </div>
  );
}

function summary(rows: CodeRow[]) {
  if (!rows.length) return 'No codes yet for this experiment.';
  const by: Record<string, { n: number; started: number }> = {};
  for (const r of rows) { const b = (by[r.condition] ??= { n: 0, started: 0 }); b.n++; if (r.status === 'started') b.started++; }
  return Object.entries(by).map(([c, b]) => `${c}: ${b.started} of ${b.n} started`).join(' · ');
}

function CodeTable({ title, note, rows, copied, copy, onCsv }: { title: string; note: ReactNode; rows: CodeRow[]; copied: string | null; copy(id: string, t: string): void; onCsv(): void }) {
  return (
    <div className="codes-out">
      <div className="row"><b>{title}</b><span className="grow" />
        <button className="btn sm ghost" disabled={!rows.length} onClick={() => copy('all', rows.map((r) => r.link).join('\n'))}>{copied === 'all' ? 'Copied' : 'Copy all links'}</button>
        <button className="btn sm ghost" disabled={!rows.length} onClick={onCsv}>Download CSV</button>
      </div>
      <p className="st-help">{note}</p>
      {!!rows.length && (
        <div className="codes-scroll">
          <table className="codes-table">
            <thead><tr><th>Code</th><th>Condition</th><th>Order</th>{rows[0].status && <th>Status</th>}<th>Link</th><th /></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.code}>
                <td className="mono">{r.code}</td><td>{r.condition}</td><td>{r.orderIndex}</td>
                {r.status && <td><span className={`chip ${r.status === 'started' ? 'leaf' : r.status === 'inactive' ? 'rose' : ''}`}>{r.status}</span></td>}
                <td className="mono link">{r.link}</td>
                <td><button className="icon-btn" aria-label={`Copy link for ${r.code}`} onClick={() => copy(r.code, r.link)}>{copied === r.code ? <Icon.check width={11} height={11} /> : <Icon.copy width={11} height={11} />}</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
