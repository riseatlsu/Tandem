import { test, expect } from '@playwright/test';
import { app, clearStorage, finishTour, openAgent, resetMock } from './helpers';

test('landing page: showcase sections, launches the demo and a chosen level', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Program cobots/ })).toBeVisible();
  await expect(page.locator('.hero-cell canvas')).toBeVisible();
  await expect(page.locator('.l-level')).toHaveCount(8);
  await expect(page.locator('.lineup-canvas canvas')).toBeAttached();
  await expect(page.getByLabel('Participant code')).toHaveCount(0); // study participants use their link
  await page.locator('.l-level', { hasText: 'Sort by color' }).click();
  await expect(page.getByText('Demo', { exact: true })).toBeVisible();
  expect(await app<string>(page, `return T.useApp.getState().taskId;`)).toBe('sort-colors');
});

test('demo tour: optional, can be skipped, replayable from Settings', async ({ page }) => {
  await clearStorage(page);
  await page.goto('/?demo&tour');
  await expect(page.locator('.tour-card')).toContainText('Welcome to Tandem');
  await page.getByRole('button', { name: 'Skip tour' }).click();
  await expect(page.locator('.tour-card')).toHaveCount(0);
  await app(page, `T.useApp.getState().set({ pendantScreen: 'settings' }); return null;`);
  await page.getByRole('button', { name: 'Take the tour' }).click();
  await finishTour(page);
});

test('AI partner visuals: plan that ticks itself, block picture, GIF, ghost preview', async ({ page }) => {
  await clearStorage(page);
  await resetMock();
  await page.goto('/?demo=factory-pick-one');
  await openAgent(page);
  const input = page.getByLabel('Message the AI partner');
  await input.fill('make me a plan');
  await input.press('Enter');
  await expect(page.locator('.plan-card').first()).toContainText('Pick the part');
  await expect(page.locator('.block-pic')).toBeVisible();
  await expect(page.locator('.clip-pic img')).toHaveAttribute('src', /clips\/teach-position\.gif$/);
  await expect(page.locator('.plan-pin')).toContainText('Next: Open the Jog screen');
  await page.getByRole('navigation', { name: 'Pendant screens' }).getByRole('button', { name: 'Jog', exact: true }).click();
  await expect(page.locator('.plan-pin')).toContainText('Next: Teach a position');
  await page.locator('.clip-pic').click();
  await expect(page.locator('.visual-modal img')).toBeVisible();
  await page.locator('.visual-modal').getByRole('button', { name: 'Close' }).click();

  await input.fill('help me pick the part');
  await input.press('Enter');
  await expect(page.locator('.proposal')).toContainText('Suggested blocks');
  await expect(page.getByText('Ghost preview — the real robot isn’t moving')).toBeVisible();
  await page.getByRole('button', { name: 'Stop preview' }).click();
  await expect(page.locator('.ghost-banner')).toHaveCount(0);
  await page.locator('.proposal').getByRole('button', { name: 'Show me' }).click();
  await expect(page.locator('.ghost-banner')).toBeVisible();
});
