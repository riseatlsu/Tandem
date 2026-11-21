/** Client for the dev-server Studio API (scripts/vite/studio-plugin.ts). */
const H = { 'X-Tandem-Studio': '1' };
const base = () => `${import.meta.env.BASE_URL.replace(/\/$/, '')}/__studio`;

async function json<T>(r: Response): Promise<T> {
  const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
  return j as T;
}
export const listModels = () => fetch(`${base()}/models`, { headers: H }).then((r) => json<{ files: string[] }>(r)).then((j) => j.files);
export const readFile = (path: string) => fetch(`${base()}/file?path=${encodeURIComponent(path)}`, { headers: H }).then((r) => json<{ exists: boolean; content: string | null }>(r));
export const saveFile = (path: string, content: string) =>
  fetch(`${base()}/save`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ path, content }) }).then((r) => json<{ ok: true }>(r));
export const studioAvailable = () => fetch(`${base()}/models`, { headers: H }).then((r) => r.ok).catch(() => false);
/** Pretty JSON with short number arrays kept on one line, matching the hand-written content files. */
export function pretty(v: unknown): string {
  return JSON.stringify(v, null, 2).replace(/\[\s+((?:-?[\d.e+-]+,\s*)*-?[\d.e+-]+)\s+\]/g, (_, inner: string) => `[${inner.replace(/\s+/g, ' ')}]`);
}

/* ---- participant codes (keys stay on the dev server; see scripts/lib/codes.ts) ---- */
export interface CodesStatus { mode: 'none' | 'live' | 'emulator'; projectId: string | null; account: string | null; keyFile: string | null; removable: boolean; expectedProject: string; siteUrl: string }
export interface CodeRow { code: string; link: string; condition: string; orderIndex: number; model: string | null; agentMode: string; status?: 'unused' | 'started' | 'inactive'; firstUsedAt?: string | null }
const post = <T>(path: string, data: unknown) => fetch(`${base()}${path}`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then((r) => json<T>(r));
export const codesStatus = () => fetch(`${base()}/codes/status`, { headers: H }).then((r) => json<CodesStatus>(r));
export const saveKey = (content: string) => post<CodesStatus>('/codes/key', { content });
export const removeKey = () => post<CodesStatus>('/codes/key/remove', {});
export const listCodes = (experiment: string, siteUrl: string) =>
  fetch(`${base()}/codes/list?experiment=${encodeURIComponent(experiment)}&siteUrl=${encodeURIComponent(siteUrl)}`, { headers: H }).then((r) => json<{ projectId: string; rows: CodeRow[] }>(r));
export const generateCodes = (experiment: string, perCondition: number, siteUrl: string) =>
  post<{ projectId: string; mode: string; rows: CodeRow[]; csvPath: string }>('/codes/generate', { experiment, perCondition, siteUrl });
