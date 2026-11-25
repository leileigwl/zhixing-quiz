import { defineConfig, devices } from '@playwright/test'

/**
 * H5 端到端测试（V3.0 起）。
 * 前置：先用占位接口地址构建 H5（与 CI 相同）：
 *   TARO_APP_API_BASE_URL=https://api.example.com TARO_APP_ALLOW_PLACEHOLDER_API=1 pnpm build:h5
 * 再 `pnpm e2e`。接口全部由 e2e/fixtures/mockApi.ts 拦截，不连真实后端。
 * 对线上只读冒烟：E2E_BASE_URL=https://study.leileigwl.cn pnpm e2e:live
 */
const PORT = Number(process.env.E2E_PORT || 4173)
const liveBase = process.env.E2E_BASE_URL

export default defineConfig({
  testDir: './e2e',
  testMatch: liveBase ? /live\.spec\.ts$/ : /^(?!.*live).*\.spec\.ts$/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: liveBase ? 90_000 : 30_000,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: liveBase || `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: liveBase
    ? undefined
    : {
        command: `node e2e/serve.mjs ${PORT} dist-h5`,
        url: `http://127.0.0.1:${PORT}/index.html`,
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
      },
})
