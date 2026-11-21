import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { app, clearStorage, finishTour, localLogs, openAgent, pendant, resetMock, runAndWait } from './helpers';

const TUTORIAL = {
  A: [{ move: 'block.above' }, { gripper: 'open' }, { move: 'block', mode: 'linear' }, { gripper: 'close' }, { move: 'block.above', mode: 'linear' }, { move: 'middle.above' }, { move: 'middle', mode: 'linear' }, { gripper: 'open' }, { move: 'middle.above', mode: 'linear' }, { move: 'ready' }],
  B: [{ gripper: 'open' }, { move: 'middle.above' }, { move: 'middle', mode: 'linear' }, { gripper: 'close' }, { move: 'middle.above', mode: 'linear' }, { move: 'right.above' }, { move: 'right', mode: 'linear' }, { gripper: 'open' }, { move: 'right.above', mode: 'linear' }, { move: 'ready' }],
};

async function setLanes(page: Page, lanes: Record<string, unknown[]>) {
  await page.waitForFunction(() => !!(window as unknown as { __tandemSetLanes?: unknown }).__tandemSetLanes);
  await page.evaluate((l) => (window as unknown as { __tandemSetLanes: (l: unknown) => void }).__tandemSetLanes(l), lanes);
  await page.waitForTimeout(500);
}
/** Insert a block after the n-th block of a lane, the way a drop does (create + connect, as one user action). */
async function dropAfter(page: Page, lane: string, n: number, type: string) {
  await page.evaluate(({ lane, n, type }) => {
    const { ws, Blockly } = (window as unknown as { __tandemBlockly: { ws: any; Blockly: any } }).__tandemBlockly; // eslint-disable-line @typescript-eslint/no-explicit-any
    const hat = ws.getTopBlocks(false).find((b: { robot?: string }) => b.robot === lane);
    let at = hat; for (let i = 0; i < n; i++) at = at.getNextBlock();
    Blockly.Events.setGroup(true);
    const b = ws.newBlock(type); b.initSvg(); b.render();
    at.nextConnection.connect(b.previousConnection);
    Blockly.Events.setGroup(false);
  }, { lane, n, type });
}
// Blockly renders and delivers events on animation frames, which are slow under software WebGL in CI: poll, don't sleep.
const settled = (page: Page, check: (rows: Record<string, number[]>) => boolean) =>
  expect.poll(async () => check(await syncRows(page)), { timeout: 20_000 }).toBe(true);
const aligned = (rows: Record<string, number[]>) => rows.A.length === rows.B.length && rows.A.every((y, i) => Math.abs(y - rows.B[i]) <= 1);
/** Bottom edge (workspace px) of every sync block, by lane, in lane order. */
function syncRows(page: Page) {
  return page.evaluate(() => {
    const { ws } = (window as unknown as { __tandemBlockly: { ws: any } }).__tandemBlockly; // eslint-disable-line @typescript-eslint/no-explicit-any
    const out: Record<string, number[]> = {};
    for (const hat of ws.getTopBlocks(false).filter((b: { type: string }) => b.type === 'lane_start')) {
      const rows: number[] = [];
      for (let b = hat.getNextBlock(); b; b = b.getNextBlock()) if (b.type.startsWith('sync')) rows.push(Math.round(b.getRelativeToSurfaceXY().y + b.height));
      out[hat.robot] = rows;
    }
    return out;
  });
}

test('two-lane blocks: Together blocks twin and line up, both lanes run, an arm waits, the task passes', async ({ page }) => {
  test.setTimeout(150_000);
  await clearStorage(page);
  await page.goto('/?demo=duo-tutorial');
  await pendant(page, 'Program');
  await expect(page.locator('.lane-status')).toContainText('Left arm: Ready');
  await expect(page.getByText('Together', { exact: true })).toBeVisible(); // toolbox category
  await setLanes(page, TUTORIAL);
  // a "Wait for each other" dropped in the left lane (after it leaves the pad) appears in the right lane too…
  await dropAfter(page, 'A', 10, 'sync_wait');
  await settled(page, (r) => r.A.length === 1 && r.B.length === 1 && aligned(r));
  // …and moving the right lane's copy to the top keeps one per lane, on the same row
  await page.evaluate(() => {
    const { ws, Blockly } = (window as unknown as { __tandemBlockly: { ws: any; Blockly: any } }).__tandemBlockly; // eslint-disable-line @typescript-eslint/no-explicit-any
    const hatB = ws.getTopBlocks(false).find((b: { robot?: string }) => b.robot === 'B');
    const twin = ws.getAllBlocks(false).find((b: { type: string; getRootBlock(): { robot?: string } }) => b.type === 'sync_wait' && b.getRootBlock().robot === 'B');
    Blockly.Events.setGroup(true);
    twin.unplug(true);
    hatB.getNextBlock().nextConnection.connect(twin.previousConnection); // right after "Open gripper"
    Blockly.Events.setGroup(false);
  });
  await settled(page, (r) => r.A.length === 1 && r.B.length === 1 && aligned(r));

  // run: the right arm waits for the left one
  await app(page, `T.host.setSpeed(2); return null;`);
  await page.getByRole('button', { name: /^Run/ }).click();
  await expect(page.locator('.lane-status')).toContainText('Right arm: Waiting for others', { timeout: 15_000 });
  await expect.poll(() => app<number>(page, `return document.querySelectorAll('.blocklyWaiting').length;`)).toBeGreaterThan(0);
  await expect.poll(() => app<string>(page, `return T.useApp.getState().runState;`), { timeout: 60_000 }).toBe('idle');
  const preds = await app<boolean[]>(page, `return T.useApp.getState().predicates.map((p) => p.pass);`);
  expect(preds).toEqual([true, true, true, true]);
  await expect(page.locator('.success-card')).toBeVisible();
});

test('a Together block dropped inside a loop is refused; deleting a Move together removes its Follow', async ({ page }) => {
  await clearStorage(page);
  await page.goto('/?demo=duo-tutorial');
  await pendant(page, 'Program');
  await setLanes(page, { A: [{ move: 'ready' }, { repeat: 2, do: [] }], B: [{ move: 'ready' }] });
  await page.evaluate(() => {
    const { ws, Blockly } = (window as unknown as { __tandemBlockly: { ws: any; Blockly: any } }).__tandemBlockly; // eslint-disable-line @typescript-eslint/no-explicit-any
    const loop = ws.getAllBlocks(false).find((b: { type: string }) => b.type === 'controls_repeat_ext');
    Blockly.Events.setGroup(true);
    const b = ws.newBlock('sync_wait'); b.initSvg(); b.render();
    loop.getInput('DO').connection.connect(b.previousConnection);
    Blockly.Events.setGroup(false);
  });
  await expect(page.locator('.toast', { hasText: 'not inside a loop' })).toBeVisible({ timeout: 20_000 });
  expect((await syncRows(page)).B).toEqual([]);
  await dropAfter(page, 'A', 1, 'sync_move');
  await expect.poll(() => app<string[]>(page, `return window.__tandemBlockly.ws.getAllBlocks(false).filter((b) => b.type === 'sync_move').map((b) => b.getRootBlock().robot + ':' + b.role).sort();`), { timeout: 20_000 }).toEqual(['A:lead', 'B:follow']);
  await page.evaluate(() => {
    const { ws } = (window as unknown as { __tandemBlockly: { ws: any } }).__tandemBlockly; // eslint-disable-line @typescript-eslint/no-explicit-any
    ws.getAllBlocks(false).find((b: { type: string; role?: string }) => b.type === 'sync_move' && b.role === 'lead').dispose(true);
  });
  await expect.poll(() => app<number>(page, `return window.__tandemBlockly.ws.getAllBlocks(false).filter((b) => b.type === 'sync_move').length;`), { timeout: 20_000 }).toBe(0);
});

test('arm picker, Teach all arms, Pause/Step with two arms', async ({ page }) => {
  await clearStorage(page);
  await page.goto('/?demo=duo-handover');
  // two-arm tasks start the demo's AI partner on gpt-5-mini; the others on the cheapest model
  expect(await app<string>(page, `return T.useApp.getState().demoModel;`)).toBe('gpt-5-mini');
  await page.getByRole('button', { name: /^Task 1:/ }).click();
  expect(await app<string>(page, `return T.useApp.getState().demoModel;`)).toBe('gpt-5-nano');
  await page.getByRole('button', { name: /^Task 10:/ }).click();
  expect(await app<string>(page, `return T.useApp.getState().demoModel;`)).toBe('gpt-5-mini');
  await pendant(page, 'Positions');
  await page.getByRole('tab', { name: 'Right arm' }).click();
  await expect(page.getByText('Right arm’s positions')).toBeVisible();
  await page.getByRole('button', { name: /Teach all arms at once/ }).click();
  const names = await app<Record<string, string[]>>(page, `return Object.fromEntries(Object.entries(T.useApp.getState().workspaces['duo-handover'].lanes).map(([k, v]) => [k, Object.keys(v.targets)]));`);
  expect(names).toEqual({ A: ['T1'], B: ['T1'] });
  await pendant(page, 'Program');
  await setLanes(page, { A: [{ move: 'tray.above' }, { move: 'ready' }], B: [{ move: 'take.above' }, { move: 'ready' }] });
  await app(page, `T.host.setSpeed(0.5); return null;`);
  await page.getByRole('button', { name: /^Run/ }).click();
  await page.getByRole('button', { name: 'Pause' }).click();
  const t0 = await app<number>(page, `return T.host.sim.simTime;`);
  await page.getByRole('button', { name: 'Step' }).click();
  await expect.poll(() => app<string>(page, `return T.useApp.getState().runState;`), { timeout: 30_000 }).toBe('paused');
  expect(await app<number>(page, `return T.host.sim.simTime;`)).toBeGreaterThan(t0);
  await page.getByRole('button', { name: 'Stop' }).click();
});

test('AI partner proposes a two-lane handover, previews both ghost arms, and it passes once accepted', async ({ page }) => {
  test.setTimeout(150_000);
  await clearStorage(page);
  await resetMock();
  await page.goto('/?demo=duo-handover');
  await openAgent(page);
  const input = page.getByLabel('Message the AI partner');
  await input.fill('help me hand the bar over');
  await input.press('Enter');
  await expect(page.locator('.proposal')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.proposal')).toContainText('4/4');
  await expect(page.locator('.ghost-banner')).toBeVisible({ timeout: 30_000 });
  await page.locator('.proposal').getByRole('button', { name: /Accept/ }).click();
  await runAndWait(page, 10);
  expect(await app<boolean[]>(page, `return T.useApp.getState().predicates.map((p) => p.pass);`)).toEqual([true, true, true, true]);
});

test('study session on a multi-arm task logs the arm on events', async ({ page }) => {
  test.setTimeout(120_000);
  await clearStorage(page);
  await page.goto('/?code=TEST-OFF-1-DUO-PILOT');
  await expect(page.getByText('Study · TEST-OFF-1-DUO-PILOT')).toBeVisible();
  await finishTour(page, { expectRequired: true });
  await pendant(page, 'Jog');
  await page.getByRole('tab', { name: 'Right arm' }).click();
  await page.getByRole('button', { name: 'J1 plus' }).click();
  await page.getByRole('button', { name: 'Teach position' }).click();
  await pendant(page, 'Positions');
  await page.getByRole('button', { name: /Teach all arms at once/ }).click();
  await app(page, `await T.flushLogs(); return null;`);
  const logs = await localLogs(page, 'local-test-off-1-duo-pilot');
  const jog = logs.find((e) => e.type === 'jog');
  expect(jog?.data.robot).toBe('B');
  expect(logs.find((e) => e.type === 'target_teach')?.data.robot).toBe('B');
  expect(logs.some((e) => e.type === 'lane_focus' && e.data.robot === 'B')).toBe(true);
  expect(logs.some((e) => e.type === 'teach_all')).toBe(true);
});

test('code mode: one editor per arm; the per-arm reference solution runs and passes', async ({ page }) => {
  test.setTimeout(120_000);
  const sol = readFileSync('tests/fixtures/solutions/duo-handover.js', 'utf8');
  await clearStorage(page);
  await page.goto('/?demo=duo-handover');
  await pendant(page, 'Settings');
  await page.getByRole('button', { name: 'Code', exact: true }).click();
  await pendant(page, 'Program');
  await expect(page.locator('.code-lane-head')).toHaveText(['Left arm', 'Right arm']);
  await expect(page.locator('.code-lane .monaco-editor')).toHaveCount(2);
  await page.evaluate((text) => {
    const lanes: Record<string, string> = {};
    for (const part of text.split(/^\/\/ @lane /m).slice(1)) { const nl = part.indexOf('\n'); lanes[part.slice(0, nl).trim()] = part.slice(nl + 1); }
    const T = (window as unknown as { __tandem: { useApp: { getState(): { workspaces: Record<string, { lanes: Record<string, { code: string }> }> } }; updateWorkspace(p: object): void } }).__tandem;
    const ws = T.useApp.getState().workspaces['duo-handover'];
    T.updateWorkspace({ lanes: Object.fromEntries(Object.entries(ws.lanes).map(([r, l]) => [r, { ...l, code: lanes[r] }])) });
  }, sol);
  await expect(page.locator('.code-lane').first()).toContainText("tray.above");
  await runAndWait(page, 10);
  expect(await app<boolean[]>(page, `return T.useApp.getState().predicates.map((p) => p.pass);`)).toEqual([true, true, true, true]);
});
