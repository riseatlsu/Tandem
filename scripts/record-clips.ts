/**
 * Records Tandem's example GIFs (public/clips/*.gif) and the landing page's level thumbnails
 * (public/landing/levels/*.jpg) by driving the real app in headless Chromium.
 *
 *   npm run mock-llm                                    # terminal 1 (the AI clip uses the scripted mock)
 *   VITE_BASE=/ VITE_E2E=true VITE_FIREBASE_API_KEY= VITE_LLM_PROXY_URL=http://localhost:8787 npx vite --port 5180   # terminal 2
 *   npx tsx scripts/record-clips.ts [--url http://localhost:5180] [--only jog-joystick,run-program] [--no-thumbs]
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium, type Page } from '@playwright/test';
import { decodePng, downscale, encodeGif, type RGBA } from './lib/gif';

const args = process.argv.slice(2);
const opt = (k: string, d?: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const URL = opt('url', 'http://localhost:5180')!;
const ONLY = opt('only')?.split(',');
const OUT_W = 720;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const PICK = [{ home: true }, { gripper: 'open' }, { waitInput: 'part_present', value: true }, { move: 'pick.approach' }, { move: 'pick', mode: 'linear' }, { gripper: 'close' }, { move: 'pick.approach', mode: 'linear' }, { move: 'place.approach' }, { move: 'place', mode: 'linear' }, { gripper: 'open' }, { move: 'place.approach', mode: 'linear' }, { home: true }];

async function open(page: Page, task: string, screen?: string) {
  await page.goto(`${URL}/?demo=${task}`);
  await page.waitForFunction(() => !!(window as unknown as { __tandem?: unknown }).__tandem && !!document.querySelector('.viewport canvas'));
  await page.evaluate((screen) => {
    const T = (window as unknown as { __tandem: { useApp: { getState(): { set(p: object): void } }; sound: { set(p: object): void } } }).__tandem;
    T.sound.set({ sfx: false, music: false });
    T.useApp.getState().set({ agentOpen: false, ...(screen ? { pendantScreen: screen } : {}) });
  }, screen);
  await sleep(1800); // meshes + fonts
}
const T = (page: Page, js: string) => page.evaluate(`(async () => { const T = window.__tandem; ${js} })()`);
const setSteps = (page: Page, steps: unknown[]) => page.evaluate((s) => (window as unknown as { __tandemSetSteps(s: unknown[]): void }).__tandemSetSteps(s), steps);

/** Captures frames (DevTools screencast, ~15 fps) while `action` runs (plus `tail` ms after), then writes the GIF. */
async function record(page: Page, id: string, action: () => Promise<void>, tail = 600) {
  const cdp = await page.context().newCDPSession(page);
  const shots: { t: number; png: Buffer }[] = [];
  let last = 0;
  cdp.on('Page.screencastFrame', (f) => {
    void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId });
    const t = (f.metadata.timestamp ?? Date.now() / 1000) * 1000;
    if (t - last >= 64 && shots.length < 400) { last = t; shots.push({ t, png: Buffer.from(f.data, 'base64') }); }
  });
  await cdp.send('Page.startScreencast', { format: 'png', maxWidth: OUT_W, maxHeight: 2000, everyNthFrame: 1 });
  await sleep(300);
  await action();
  await sleep(tail);
  await cdp.send('Page.stopScreencast');
  await cdp.detach();
  const frames: RGBA[] = shots.map((s) => downscale(decodePng(s.png), OUT_W));
  const w = frames[0].width, h = frames[0].height;
  const same = frames.filter((f) => f.width === w && f.height === h);
  const delays = shots.map((s, i) => (shots[i + 1]?.t ?? s.t + 100) - s.t).slice(0, same.length);
  delays[delays.length - 1] += 1200; // pause on the last frame before looping
  const gif = encodeGif(same, delays);
  writeFileSync(`public/clips/${id}.gif`, gif);
  console.log(`✓ ${id}.gif  ${same.length} frames ${w}×${h}, ${(gif.length / 1024).toFixed(0)} KB`);
}

async function dragStick(page: Page, dx: number, dy: number, ms: number) {
  const knob = page.getByRole('slider', { name: 'Joystick' }).first();
  const b = (await knob.boundingBox())!;
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  const n = 12;
  for (let i = 1; i <= n; i++) { await page.mouse.move(x + (dx * i) / n, y + (dy * i) / n); await sleep(40); }
  await sleep(ms);
  await page.mouse.up();
}
async function runAndWait(page: Page, speed: number, maxMs = 30_000) {
  await T(page, `T.host.setSpeed(${speed}); return null;`);
  await page.getByRole('button', { name: /^Run/ }).click();
  const t0 = Date.now();
  await sleep(500);
  while (Date.now() - t0 < maxMs && (await T(page, `return T.useApp.getState().runState;`)) !== 'idle') await sleep(150);
}

const CLIPS: Record<string, (p: Page) => Promise<void>> = {
  'jog-joystick': async (p) => {
    await open(p, 'tut-jog-teach', 'jog');
    await record(p, 'jog-joystick', async () => {
      await dragStick(p, 46, -30, 1100);
      await sleep(300);
      await p.locator('[data-tour="jog-modes"] button', { hasText: 'Linear' }).click();
      await sleep(300);
      await dragStick(p, -40, 0, 900);
      await dragStick(p, 0, 40, 700);
    });
  },
  'teach-position': async (p) => {
    await open(p, 'tut-jog-teach', 'jog');
    await p.locator('[data-tour="jog-modes"] button', { hasText: 'Linear' }).click();
    await record(p, 'teach-position', async () => {
      await dragStick(p, 0, 44, 900);
      await sleep(250);
      await p.locator('[data-tour="jog-teach"]').click();
      await sleep(900);
      await T(p, `T.useApp.getState().set({ pendantScreen: 'positions' }); return null;`);
      await sleep(1200);
    });
  },
  'hand-guide': async (p) => {
    await open(p, 'tut-jog-teach', 'jog');
    await record(p, 'hand-guide', async () => {
      await p.locator('[data-tour="jog-handguide"]').click();
      await sleep(600);
      for (let i = 0; i < 14; i++) { await p.evaluate(() => (window as unknown as { __tandemGuide(x: number, y: number, z: number): boolean }).__tandemGuide(0, 9, -6)); await sleep(70); }
      for (let i = 0; i < 10; i++) { await p.evaluate(() => (window as unknown as { __tandemGuide(x: number, y: number, z: number): boolean }).__tandemGuide(-10, 0, 0)); await sleep(70); }
      await sleep(400);
    });
  },
  'build-blocks': async (p) => {
    await open(p, 'tut-first-program', 'program');
    await setSteps(p, []);
    const prog = [{ home: true }, { gripper: 'open' }, { move: 'pick.approach' }, { move: 'pick', mode: 'linear' }, { gripper: 'close' }, { move: 'pick.approach', mode: 'linear' }];
    await record(p, 'build-blocks', async () => {
      for (let i = 1; i <= prog.length; i++) { await setSteps(p, prog.slice(0, i)); await sleep(650); }
      await sleep(600);
    });
  },
  'approach-retreat': async (p) => {
    await open(p, 'factory-pick-one', 'program');
    await setSteps(p, PICK.slice(0, 7));
    await sleep(800);
    await record(p, 'approach-retreat', () => runAndWait(p, 1, 14_000));
  },
  'run-program': async (p) => {
    await open(p, 'tut-first-program', 'program');
    await setSteps(p, [{ home: true }, { gripper: 'open' }, { move: 'pick.approach' }, { move: 'pick', mode: 'linear' }, { gripper: 'close' }, { move: 'pick.approach', mode: 'linear' }, { move: 'place.approach' }, { move: 'place', mode: 'linear' }, { gripper: 'open' }, { move: 'place.approach', mode: 'linear' }, { home: true }]);
    await sleep(800);
    await record(p, 'run-program', () => runAndWait(p, 2.5, 16_000), 1200);
  },
  'conveyor-wait': async (p) => {
    await open(p, 'factory-pick-one', 'io');
    await setSteps(p, PICK);
    await sleep(600);
    await record(p, 'conveyor-wait', () => runAndWait(p, 2, 16_000));
  },
  'loop-repeat': async (p) => {
    await open(p, 'factory-pick-one', 'program');
    await setSteps(p, [{ home: true }, { gripper: 'open' }, { repeat: 2, do: [{ waitInput: 'part_present', value: true }, { move: 'pick.approach' }, { move: 'pick', mode: 'linear' }, { gripper: 'close' }, { move: 'pick.approach', mode: 'linear' }, { move: 'bin.drop' }, { gripper: 'open' }] }, { home: true }]);
    await sleep(800);
    await record(p, 'loop-repeat', () => runAndWait(p, 3, 20_000));
  },
  'fault-recover': async (p) => {
    await open(p, 'factory-pick-one', 'program');
    await setSteps(p, [{ home: true }, { move: 'pick.approach' }, { moveOffset: 'pick', dz: 900, mode: 'linear' }, { home: true }]);
    await sleep(800);
    await record(p, 'fault-recover', async () => {
      await runAndWait(p, 1.5, 10_000);
      await sleep(1600);
      await p.getByRole('button', { name: /Reset scene/ }).click();
      await sleep(900);
    });
  },
  'ai-suggestion': async (p) => {
    await fetch('http://localhost:8787/__reset', { method: 'POST' });
    await p.evaluate(() => localStorage.setItem('tandem.agentPos', JSON.stringify({ right: 24, bottom: 84 }))); // over the pendant, so the ghost is visible
    await open(p, 'factory-pick-one', 'program');
    await setSteps(p, [{ home: true }]);
    await sleep(600);
    await record(p, 'ai-suggestion', async () => {
      await p.getByRole('button', { name: 'Open AI partner' }).click();
      const input = p.getByLabel('Message the AI partner');
      await input.pressSequentially('help me pick the part', { delay: 35 });
      await input.press('Enter');
      await p.locator('.proposal').waitFor({ timeout: 20_000 });
      await sleep(6500); // ghost preview
      await p.locator('.proposal').getByRole('button', { name: /Accept/ }).click();
      await sleep(1400);
    });
  },
};

async function thumbs(page: Page) {
  mkdirSync('public/landing/levels', { recursive: true });
  // every task listed in the demo gets a landing-page thumbnail
  const demo = readdirSync('content/tasks').map((f) => JSON.parse(readFileSync(`content/tasks/${f}`, 'utf8')) as { id: string; demo?: unknown }).filter((t) => t.demo).map((t) => t.id);
  for (const id of demo) {
    await open(page, id);
    await T(page, `T.useApp.getState().set({ showFrames: false }); return null;`);
    await page.addStyleTag({ content: '.vp-overlay{display:none!important}' });
    await sleep(600);
    await page.locator('.viewport').screenshot({ path: `public/landing/levels/${id}.jpg`, type: 'jpeg', quality: 78 });
    console.log(`✓ levels/${id}.jpg`);
  }
}

// Metal (Apple GPU) renders at 60 fps headless; elsewhere fall back with --swiftshader
const GL = args.includes('--swiftshader') ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: [...GL, '--disable-renderer-backgrounding', '--disable-background-timer-throttling'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.goto(URL);
await page.evaluate(() => localStorage.clear());
const reset = () => page.evaluate(() => localStorage.removeItem('tandem.agentPos'));
mkdirSync('public/clips', { recursive: true });
for (const [id, fn] of Object.entries(CLIPS)) if (!ONLY || ONLY.includes(id)) { await fn(page); await reset(); }
if (!args.includes('--no-thumbs') && !ONLY) await thumbs(page);
await browser.close();
