import type { Firestore } from 'firebase-admin/firestore';

export interface LlmConfig {
  enabled: boolean;
  demoModels: string[];
  limits: { demo: { requests: number; tokens: number }; study: { requests: number; tokens: number } };
  demoDailyTokenBudget: number;
  maxOutputTokens: number;
}
export const DEFAULT_CONFIG: LlmConfig = {
  enabled: true,
  demoModels: ['gpt-5-nano', 'gpt-5-mini', 'gpt-4.1-mini'],
  limits: { demo: { requests: 40, tokens: 150_000 }, study: { requests: 600, tokens: 3_000_000 } },
  demoDailyTokenBudget: 3_000_000,
  maxOutputTokens: 4000,
};
let cache: { at: number; cfg: LlmConfig } | null = null;
export async function getConfig(db: Firestore): Promise<LlmConfig> {
  if (cache && Date.now() - cache.at < Number(process.env.CONFIG_CACHE_MS ?? 15_000)) return cache.cfg;
  const snap = await db.doc('config/llm').get();
  const cfg = { ...DEFAULT_CONFIG, ...(snap.exists ? snap.data() : {}) } as LlmConfig;
  cache = { at: Date.now(), cfg };
  return cfg;
}
export const clearConfigCache = () => { cache = null; };

export function allowedOrigins(): string[] {
  return (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((s) => s.trim()).filter(Boolean);
}
export const today = () => new Date().toISOString().slice(0, 10).replace(/-/g, '');
