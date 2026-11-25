import { expect, test } from '@playwright/test'

/**
 * 线上只读冒烟（不登录、不发验证码、不写任何数据）：
 *   E2E_BASE_URL=https://study.leileigwl.cn pnpm e2e:live
 */
test.use({ navigationTimeout: 60_000 })

test('线上：根路径 → 门头页，备案号可见', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page).toHaveURL(/#\/pages\/landing\/index/, { timeout: 45_000 })
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 45_000 })
  await expect(page.locator('.ld-icp')).toHaveAttribute('href', 'https://beian.miit.gov.cn/')
})

test('线上：点登录进入邮箱登录页', async ({ page }) => {
  await page.goto('/#/pages/landing/index', { waitUntil: 'domcontentloaded' })
  await page.locator('.ld-hero .ld-btn-primary').click({ timeout: 45_000 })
  await expect(page).toHaveURL(/#\/pages\/login\/index/, { timeout: 30_000 })
  await expect(page.locator('.taro_page:visible .login-title').last()).toHaveText('邮箱登录')
})

test('线上：未登录打开应用内页面会先去登录页', async ({ page }) => {
  await page.goto('/#/pages/profile/index', { waitUntil: 'domcontentloaded' })
  await expect(page).toHaveURL(/#\/pages\/login\/index/, { timeout: 45_000 })
})
