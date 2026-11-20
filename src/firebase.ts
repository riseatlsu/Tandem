/** Lazy Firebase access (Anonymous Auth, Firestore, callable functions). Everything degrades gracefully when unconfigured. */
import { CONFIG } from './config';
import type { FirebaseApp } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let ready: Promise<void> | null = null;

export const firebaseEnabled = () => !!CONFIG.firebase;

export function initFirebase(): Promise<void> {
  if (!CONFIG.firebase) return Promise.resolve();
  if (ready) return ready;
  ready = (async () => {
    const { initializeApp } = await import('firebase/app');
    const { getAuth, signInAnonymously, connectAuthEmulator, onAuthStateChanged } = await import('firebase/auth');
    const { getFirestore, connectFirestoreEmulator } = await import('firebase/firestore');
    app = initializeApp(CONFIG.firebase!);
    auth = getAuth(app);
    db = getFirestore(app);
    if (CONFIG.useEmulators) {
      connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      connectFirestoreEmulator(db, '127.0.0.1', 8080);
    }
    await new Promise<void>((res) => { const off = onAuthStateChanged(auth!, () => { off(); res(); }); });
    if (!auth.currentUser) await signInAnonymously(auth);
  })();
  return ready;
}

export async function getIdToken(): Promise<string | null> {
  if (!CONFIG.firebase) return null;
  await initFirebase();
  return (await auth?.currentUser?.getIdToken()) ?? null;
}
export const currentUid = () => auth?.currentUser?.uid ?? null;
export async function getDb(): Promise<Firestore | null> { await initFirebase(); return db; }

/** POST to an HTTPS function with the ID token. */
export async function callFunction<T>(name: string, body: unknown): Promise<T> {
  const tok = await getIdToken();
  const base = CONFIG.functionsUrl || CONFIG.llmProxyUrl.replace(/\/llmProxy$/, '');
  const r = await fetch(`${base}/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tok ? { 'X-Firebase-Token': tok } : {}) }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error((j as { error?: string }).error ?? `HTTP ${r.status}`), { status: r.status, body: j });
  return j as T;
}
