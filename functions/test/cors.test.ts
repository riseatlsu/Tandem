import { describe, expect, it } from 'vitest';
import { cors } from '../src/http.js';

function fake(method: string, origin?: string) {
  const headers: Record<string, string> = {};
  let status = 0;
  const res = { setHeader: (k: string, v: string) => { headers[k.toLowerCase()] = v; }, status(s: number) { status = s; return res; }, end() { return res; } };
  const req = { method, headers: origin ? { origin } : {} };
  return { req, res, headers, get status() { return status; } };
}
describe('cors()', () => {
  process.env.ALLOWED_ORIGINS = 'https://me.github.io';
  it('reflects only allowed origins', () => {
    const a = fake('POST', 'https://me.github.io');
    expect(cors(a.req as never, a.res as never)).toBe(false);
    expect(a.headers['access-control-allow-origin']).toBe('https://me.github.io');
    const b = fake('POST', 'https://evil.example');
    cors(b.req as never, b.res as never);
    expect(b.headers['access-control-allow-origin']).toBeUndefined();
  });
  it('rejects preflights from other origins', () => {
    const b = fake('OPTIONS', 'https://evil.example');
    expect(cors(b.req as never, b.res as never)).toBe(true);
    expect(b.status).toBe(403);
    const a = fake('OPTIONS', 'https://me.github.io');
    cors(a.req as never, a.res as never);
    expect(a.status).toBe(204);
  });
});
