import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  // CI renders WebGL in software (SwiftShader): the first 3D frame compiles shaders for ~20 s. Real GPUs take well under a second.
  expect: { timeout: 45_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4173', viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure', launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: [
    { command: 'npx tsx tests/fixtures/mock-llm/server.ts', port: 8787, reuseExistingServer: !process.env.CI },
    {
      command: 'npx vite build --mode e2e && npx vite preview --port 4173 --strictPort',
      port: 4173, timeout: 240_000, reuseExistingServer: !process.env.CI,
      env: { VITE_BASE: '/', VITE_E2E: 'true', VITE_LLM_PROXY_URL: 'http://localhost:8787' },
    },
  ],
});
