import { describe, expect, it } from 'vitest';
import { linkFor, parseKey, planCodes, toCsv } from '../../scripts/lib/codes';
import { safe } from '../../scripts/vite/studio-plugin';

const exp = { id: 'x', version: '1', conditions: { a: { agent: { mode: 'suggest', model: 'm' } }, b: { agent: { mode: 'off' } } } };

describe('participant codes', () => {
  it('plans codes per condition, continuing orderIndex and avoiding taken codes', () => {
    const rows = planCodes(exp, 3, 'https://s.test/app', { a: 5 }, new Set());
    expect(rows.filter((r) => r.condition === 'a').map((r) => r.orderIndex)).toEqual([5, 6, 7]);
    expect(rows.filter((r) => r.condition === 'b').map((r) => r.orderIndex)).toEqual([0, 1, 2]);
    expect(new Set(rows.map((r) => r.code)).size).toBe(6);
    for (const r of rows) { expect(r.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/); expect(r.link).toBe(`https://s.test/app/?code=${r.code}`); }
    expect(rows.find((r) => r.condition === 'b')!.model).toBeNull();
  });
  it('writes CSV with a link column', () => {
    expect(toCsv([{ code: 'AAAA-BBBB', link: linkFor('https://s.test/', 'AAAA-BBBB'), condition: 'a', orderIndex: 0, model: null, agentMode: 'off' }]))
      .toBe('code,link,condition,orderIndex,model,agentMode\nAAAA-BBBB,https://s.test/?code=AAAA-BBBB,a,0,,off\n');
  });
  it('accepts only service-account keys', () => {
    expect(() => parseKey('nope')).toThrow(/not JSON/);
    expect(() => parseKey('{"type":"authorized_user"}')).toThrow(/service-account/);
    expect(parseKey('{"type":"service_account","project_id":"p","client_email":"e","private_key":"k"}').project_id).toBe('p');
  });
  it('Studio file API can never touch keys/', () => {
    expect(safe('keys/service-account.json')).toBeNull();
    expect(safe('content/../keys/service-account.json')).toBeNull();
  });
});
