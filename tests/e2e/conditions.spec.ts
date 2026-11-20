import { test, expect } from '@playwright/test';
import { clearStorage, mockRequests, resetMock } from './helpers';

test('qa condition: no editing tools are offered to the model and no proposal UI', async ({ page }) => {
  await clearStorage(page);
  await resetMock();
  await page.goto('/?code=TEST-QA-1');
  await expect(page.getByText('Study · TEST-QA-1')).toBeVisible();
  await expect(page.locator('.panel-head .chip', { hasText: 'Q&A' })).toBeVisible();
  const input = page.getByLabel('Message the AI partner');
  await input.fill('How do I make a linear move?');
  await input.press('Enter');
  await expect(page.locator('.msg.assistant').last()).toContainText('robot.moveL');
  const tools = (await mockRequests()).at(-1)!.tools;
  expect(tools).toContain('read_task');
  expect(tools).not.toContain('dry_run');
  expect(tools).not.toContain('propose_patch');
  await expect(page.locator('.proposal')).toHaveCount(0);
});

test('off condition: the AI partner is not rendered', async ({ page }) => {
  await clearStorage(page);
  await page.goto('/?code=TEST-OFF-1');
  await expect(page.getByText('Study · TEST-OFF-1')).toBeVisible();
  await expect(page.getByLabel('AI partner')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Run/ })).toBeVisible();
});
