import type { Request } from 'firebase-functions/v2/https';
import type { Response } from 'express';
import { getAuth } from 'firebase-admin/auth';
import { allowedOrigins } from './config.js';

/** CORS for the GitHub Pages origin(s). Returns true if the request was a preflight that has been answered. */
export function cors(req: Request, res: Response): boolean {
  const origin = req.headers.origin;
  if (origin && allowedOrigins().includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Firebase-Token, X-Session-Id, X-Stainless-Lang, X-Stainless-Package-Version, X-Stainless-OS, X-Stainless-Arch, X-Stainless-Runtime, X-Stainless-Runtime-Version, X-Stainless-Retry-Count, X-Stainless-Timeout');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '3600');
  }
  if (req.method === 'OPTIONS') { res.status(origin && allowedOrigins().includes(origin) ? 204 : 403).end(); return true; }
  return false;
}

export async function verify(req: Request): Promise<string | null> {
  const tok = req.headers['x-firebase-token'];
  if (typeof tok !== 'string' || !tok) return null;
  try { return (await getAuth().verifyIdToken(tok)).uid; } catch { return null; }
}

export const fail = (res: Response, status: number, error: string, extra: object = {}) => res.status(status).json({ error, ...extra });
