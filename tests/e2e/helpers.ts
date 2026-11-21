import { expect, type Page } from '@playwright/test';

export const MOCK = 'http://localhost:8787';
export async function resetMock() { await fetch(`${MOCK}/__reset`, { method: 'POST' }); }
export async function mockRequests(): Promise<{ model: string; tools: string[] }[]> { return (await fetch(`${MOCK}/__requests`)).json(); }

/** Evaluate against the app's debug handle (exposed when VITE_E2E=true). */
export async function app<T>(page: Page, fn: string): Promise<T> {
  await page.waitForFunction(() => !!(window as unknown as { __tandem?: unknown }).__tandem);
  return page.evaluate(`(async () => { const T = window.__tandem; ${fn} })()`) as Promise<T>;
}
export async function setBlocks(page: Page, steps: unknown[]) {
  await page.waitForFunction(() => !!(window as unknown as { __tandemSetSteps?: unknown }).__tandemSetSteps);
  await page.evaluate((steps) => (window as unknown as { __tandemSetSteps: (s: unknown[]) => void }).__tandemSetSteps(steps), steps);
}
export async function runAndWait(page: Page, speed = 10) {
  await app(page, `T.host.setSpeed(${speed}); return null;`);
  await page.getByRole('button', { name: /^Run/ }).click();
  await expect.poll(() => app<string>(page, `return T.useApp.getState().runState;`), { timeout: 90_000 }).toBe('idle');
}
export async function clearStorage(page: Page) {
  await page.goto('/?demo');
  await page.evaluate(async () => { localStorage.clear(); await new Promise<void>((r) => { const q = indexedDB.deleteDatabase('keyval-store'); q.onsuccess = q.onerror = q.onblocked = () => r(); }); });
}
export async function localLogs(page: Page, sessionId: string): Promise<{ seq: number; type: string; data: Record<string, unknown> }[]> {
  return page.evaluate(async (sid) => {
    const db: IDBDatabase = await new Promise((res, rej) => { const r = indexedDB.open('keyval-store'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const get = (k: string) => new Promise<unknown>((res) => { const tx = db.transaction('keyval', 'readonly'); const g = tx.objectStore('keyval').get(k); g.onsuccess = () => res(g.result); g.onerror = () => res(undefined); });
    const batches = ((await get(`tandem.localbatches.${sid}`)) ?? []) as unknown[][];
    const queued = ((await get(`tandem.logqueue.${sid}`)) ?? []) as unknown[];
    return [...batches.flat(), ...queued] as { seq: number; type: string; data: Record<string, unknown> }[];
  }, sessionId);
}

/** Open a teach-pendant screen: dock items directly, the rest from the Home screen. */
export async function pendant(page: Page, name: 'Home' | 'Program' | 'Jog' | 'Positions' | 'Task' | 'I/O' | 'Log' | 'Settings') {
  const dock = page.getByRole('navigation', { name: 'Pendant screens' });
  if (['Home', 'Program', 'Jog', 'Positions'].includes(name)) { await dock.getByRole('button', { name, exact: true }).click(); return; }
  await dock.getByRole('button', { name: 'Home', exact: true }).click();
  if (name === 'Task') await page.locator('.task-card').click();
  else await page.locator('.app-tile', { hasText: name }).click();
}
export async function openAgent(page: Page) {
  await page.getByRole('button', { name: 'Open AI partner' }).click();
  await expect(page.getByLabel('Message the AI partner')).toBeVisible();
}

/** Walk through the guided tour: Next where allowed, otherwise click the spotlighted control. */
export async function finishTour(page: Page, { expectRequired = false } = {}) {
  const card = page.locator('.tour-card');
  await expect(card).toBeVisible();
  if (expectRequired) await expect(card.getByRole('button', { name: 'Skip tour' })).toHaveCount(0);
  for (let i = 0; i < 30 && (await card.count()); i++) {
    const next = card.locator('.tour-foot .btn.aqua');
    if (await next.isDisabled()) {
      // click the step's own target (the spotlight can lag a step behind when rendering is slow)
      const target = await page.locator('.tour-spot').getAttribute('data-target');
      await page.locator(`[data-tour="${target}"]`).click();
    } else await next.click();
    await page.waitForTimeout(250);
  }
  await expect(card).toHaveCount(0);
}
