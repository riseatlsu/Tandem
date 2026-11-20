import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { today } from './config.js';

export interface QuotaCheck { key: string; requests: number; tokens: number }
/** Atomically check every counter and, if all are below their limits, count one request. Returns the scope that is exhausted, or null. */
export async function checkAndCount(db: Firestore, checks: QuotaCheck[]): Promise<string | null> {
  return db.runTransaction(async (tx) => {
    const refs = checks.map((c) => db.doc(`usage/${c.key}_${today()}`));
    const snaps = await Promise.all(refs.map((r) => tx.get(r)));
    for (let i = 0; i < checks.length; i++) {
      const d = snaps[i].data() ?? {};
      if ((d.requests ?? 0) >= checks[i].requests || (d.promptTokens ?? 0) + (d.completionTokens ?? 0) >= checks[i].tokens) return checks[i].key.split('_')[0];
    }
    refs.forEach((r) => tx.set(r, { requests: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() }, { merge: true }));
    return null;
  });
}
export async function addTokens(db: Firestore, keys: string[], usage: { prompt_tokens?: number; completion_tokens?: number }) {
  const batch = db.batch();
  for (const k of keys) batch.set(db.doc(`usage/${k}_${today()}`), { promptTokens: FieldValue.increment(usage.prompt_tokens ?? 0), completionTokens: FieldValue.increment(usage.completion_tokens ?? 0) }, { merge: true });
  await batch.commit();
}
