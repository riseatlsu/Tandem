import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { app, clearStorage, localLogs, resetMock, runAndWait, setBlocks } from './helpers';

const POUR = readFileSync('tests/fixtures/solutions/kitchen-pour.js', 'utf8');

test('study happy path: teach → fault → AI fix → pour → resume → finish, fully logged', async ({ page }) => {
  await clearStorage(page);
  await resetMock();
  await page.route('https://example.org/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Survey</h1>' }));

  await page.goto('/?code=TEST-SUGGEST-1');
  await expect(page.getByText('Study · TEST-SUGGEST-1')).toBeVisible();
  await expect(page.getByText('Task 1 of 3')).toBeVisible();
  await expect(page.getByLabel('Model')).toHaveCount(0); // model is locked (no picker)
  await expect(page.locator('.panel-head .chip', { hasText: 'gpt-5-mini' })).toBeVisible();

  // ---- Task 1: jog, hand guide, teach P1
  await page.getByRole('button', { name: 'J1 plus' }).click();
  await page.getByRole('button', { name: 'Hand guide' }).click();
  expect(await page.evaluate(() => (window as unknown as { __tandemGuide: (dx: number) => boolean }).__tandemGuide(50))).toBe(true);
  await page.getByRole('button', { name: 'Teach' }).first().click();
  await expect(page.locator('.target-row .name', { hasText: /^P1$/ })).toBeVisible();
  await expect(page.locator('.checklist li.pass')).toHaveCount(1);
  await page.getByRole('button', { name: /Next task/ }).click();

  // ---- Task 2: blocks with an unreachable move → protective stop → ask AI → accept → pass
  await expect(page.getByText('Task 2 of 3')).toBeVisible();
  await setBlocks(page, [{ home: true }, { moveOffset: 'place', dx: 900, dy: 0, dz: 0 }]);
  await runAndWait(page);
  await expect(page.getByText('PROTECTIVE STOP · UNREACHABLE')).toBeVisible();
  await page.getByRole('button', { name: 'Ask AI partner about this' }).click();
  const card = page.locator('.proposal');
  await expect(card).toContainText('Suggested blocks');
  await expect(card).toContainText('3/3 goals');
  await card.getByRole('button', { name: 'Accept' }).click();
  await expect(card).toContainText('Applied');
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await runAndWait(page);
  await expect(page.getByText('TASK COMPLETE')).toBeVisible();
  await page.getByRole('button', { name: /Next task/ }).click();

  // ---- Task 3: code; reload mid-task resumes with program intact
  await expect(page.getByText('Task 3 of 3')).toBeVisible();
  await app(page, `T.updateWorkspace({ code: ${JSON.stringify(POUR)} }); return null;`);
  await page.waitForTimeout(3600); // checkpoint interval
  await page.reload();
  await expect(page.getByText('Task 3 of 3')).toBeVisible();
  expect(await app<string>(page, `return T.useApp.getState().workspaces[T.useApp.getState().taskId].code;`)).toBe(POUR);
  await runAndWait(page);
  await expect(page.getByText('TASK COMPLETE')).toBeVisible();
  await page.getByRole('button', { name: /Finish/ }).click();
  await page.waitForURL(/example\.org/);
  expect(page.url()).toContain('pid=TEST-SUGGEST-1');

  // ---- Logs: contiguous, complete, and token-free
  await page.goto('/?study=1');
  const logs = (await localLogs(page, 'local-test-suggest-1')).sort((a, b) => a.seq - b.seq);
  const seqs = logs.map((e) => e.seq);
  expect(seqs).toEqual(Array.from({ length: seqs.length }, (_, i) => i + 1));
  const types = logs.map((e) => e.type);
  const order = ['session_start', 'task_start', 'handguide_start', 'handguide_end', 'target_teach', 'task_start', 'run_start', 'run_fault', 'agent_user_msg', 'agent_tool_call', 'agent_proposal', 'agent_proposal_decision', 'run_end', 'task_start', 'resume', 'session_end'];
  let from = 0;
  for (const t of order) { const i = types.indexOf(t, from); expect(i, `expected ${t} after index ${from}`).toBeGreaterThanOrEqual(0); from = i + 1; }
  expect(logs.some((e) => e.type === 'run_fault' && e.data.code === 'UNREACHABLE')).toBe(true);
  expect(logs.some((e) => e.type === 'agent_tool_call' && e.data.name === 'dry_run')).toBe(true);
  expect(logs.some((e) => e.type === 'agent_proposal_decision' && e.data.decision === 'accepted')).toBe(true);
  expect(logs.some((e) => e.type === 'run_end' && e.data.outcome === 'completed' && (e.data.predicates as { pass: boolean }[]).every((p) => p.pass))).toBe(true);
  expect(JSON.stringify(logs)).not.toMatch(/eyJ[\w-]{10,}\.[\w-]{10,}\./);
});
