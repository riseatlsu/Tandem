/**
 * Export study logs.  npx tsx scripts/export-logs.ts --experiment pilot [--out exports/pilot] [--project id] [--emulator]
 * Produces events.jsonl, sessions.csv, runs.csv, agent_turns.csv, proposals.csv and reports seq gaps.
 */
import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (k: string, d?: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const expId = opt('experiment');
if (!expId) { console.error('Usage: export-logs --experiment <id> [--out dir] [--project id] [--emulator]'); process.exit(1); }
if (args.includes('--emulator')) process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
const out = opt('out', `exports/${expId}`)!;
const { initializeApp } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
initializeApp({ projectId: opt('project', args.includes('--emulator') ? 'demo-tandem' : undefined) });
const db = getFirestore();

interface Ev { seq: number; t: number; sessionId: string; type: string; taskId?: string; taskIndex?: number; simTime?: number; data: Record<string, unknown> }
const csv = (rows: Record<string, unknown>[]) => {
  if (!rows.length) return '';
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const esc = (v: unknown) => { const s = v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n') + '\n';
};

mkdirSync(out, { recursive: true });
const sessions = await db.collection('sessions').where('experimentId', '==', expId).get();
const all: Ev[] = [];
const sessionRows: Record<string, unknown>[] = [];
let gaps = 0;
for (const s of sessions.docs) {
  const batches = await s.ref.collection('batches').orderBy('seqStart').get();
  const evs: Ev[] = batches.docs.flatMap((b) => (b.data().events as (Omit<Ev, 'data'> & { data: string })[]).map((e) => ({ ...e, data: JSON.parse(e.data || '{}') })));
  const bySeq = new Map(evs.map((e) => [e.seq, e]));
  const seqs = [...bySeq.keys()].sort((a, b) => a - b);
  const missing: number[] = [];
  for (let i = 1; i < seqs.length; i++) for (let k = seqs[i - 1] + 1; k < seqs[i]; k++) missing.push(k);
  if (missing.length) { gaps += missing.length; console.error(`⚠ ${s.id}: ${missing.length} missing seq (${missing.slice(0, 10).join(', ')}${missing.length > 10 ? '…' : ''})`); }
  const ordered = seqs.map((k) => bySeq.get(k)!);
  all.push(...ordered);
  const d = s.data();
  sessionRows.push({ sessionId: s.id, code: d.code, condition: d.condition, orderIndex: d.orderIndex, events: ordered.length, missingSeq: missing.length,
    started: ordered[0] ? new Date(ordered[0].t).toISOString() : '', ended: ordered.find((e) => e.type === 'session_end') ? new Date(ordered.find((e) => e.type === 'session_end')!.t).toISOString() : '' });
}
writeFileSync(`${out}/events.jsonl`, all.map((e) => JSON.stringify(e)).join('\n') + '\n');
writeFileSync(`${out}/sessions.csv`, csv(sessionRows));
writeFileSync(`${out}/runs.csv`, csv(all.filter((e) => e.type === 'run_end').map((e) => ({ sessionId: e.sessionId, taskId: e.taskId, runId: e.data.runId, outcome: e.data.outcome, simDurationSec: e.data.simDurationSec, passed: (e.data.predicates as { pass: boolean }[] | undefined)?.every((p) => p.pass), t: e.t }))));
writeFileSync(`${out}/agent_turns.csv`, csv(all.filter((e) => e.type.startsWith('agent_') && e.type !== 'agent_proposal' && e.type !== 'agent_proposal_decision').map((e) => ({ sessionId: e.sessionId, taskId: e.taskId, type: e.type, t: e.t, text: e.data.text, tool: e.data.name, model: e.data.model, latencyMs: e.data.latencyMs }))));
writeFileSync(`${out}/proposals.csv`, csv(all.filter((e) => e.type === 'agent_proposal' || e.type === 'agent_proposal_decision').map((e) => ({ sessionId: e.sessionId, taskId: e.taskId, type: e.type, proposalId: e.data.proposalId, decision: e.data.decision, timeToDecisionMs: e.data.timeToDecisionMs, dryRun: e.data.dryRun, t: e.t }))));
console.error(`✓ ${sessions.size} sessions, ${all.length} events → ${out}${gaps ? ` (${gaps} gaps)` : ''}`);
