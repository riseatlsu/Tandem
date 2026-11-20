import { test, expect } from '@playwright/test';
import { MOCK, app, clearStorage, mockRequests, openAgent, resetMock, runAndWait, setBlocks } from './helpers';

test('demo: no code needed, streamed answer, nothing logged, quota message, sim keeps working', async ({ page }) => {
  await clearStorage(page);
  await resetMock();
  await page.goto('/?demo');
  await expect(page.locator('.chip', { hasText: 'Demo' })).toBeVisible();
  await openAgent(page);
  await page.getByLabel('Model').selectOption('gpt-5-nano');
  const input = page.getByLabel('Message the AI partner');
  await input.fill('How do I make a linear move?');
  await input.press('Enter');
  await expect(page.locator('.msg.assistant').last()).toContainText('robot.moveL');
  expect((await mockRequests()).at(-1)!.model).toBe('gpt-5-nano');
  expect(await page.evaluate(() => (window as unknown as { __tandemLogs?: unknown }).__tandemLogs)).toBeUndefined();

  await fetch(`${MOCK}/__quota?n=0`, { method: 'POST' });
  await input.fill('Another question');
  await input.press('Enter');
  await expect(page.locator('.msg.assistant').last()).toContainText('usage limit');

  await page.getByRole('button', { name: /^Task 2:/ }).click();
  await setBlocks(page, [{ home: true }, { move: 'place.approach' }, { move: 'bin.drop' }, { home: true }]);
  await runAndWait(page);
  expect(await app<string>(page, `return T.useApp.getState().lastTrace.outcome;`)).toBe('completed');
  await expect(page.getByText('TASK COMPLETE')).toBeVisible();
});

test('sandbox: no network access, runaway loops are stopped', async ({ page }) => {
  await page.goto('/?demo');
  await page.getByRole('button', { name: /^Task 2:/ }).click();
  await app(page, `T.updateWorkspace({ editor: 'code', code: "await robot.home();\\nawait fetch('https://example.com');\\n" }); return null;`);
  await runAndWait(page);
  expect(await app<{ code: string; line: number }>(page, `return T.useApp.getState().lastTrace.fault;`)).toMatchObject({ code: 'USER_ERROR', line: 2 });
  await app(page, `T.updateWorkspace({ code: "await robot.home();\\nwhile (true) {}\\n" }); return null;`);
  const t0 = Date.now();
  await runAndWait(page);
  expect(await app<string>(page, `return T.useApp.getState().lastTrace.fault.code;`)).toBe('RUNAWAY');
  expect(Date.now() - t0).toBeLessThan(15_000);
});
