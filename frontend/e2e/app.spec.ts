import { expect, test, type Page } from '@playwright/test'
import { installMockApi, LOGIN_INIT_SCRIPT } from './fixtures/mockApi'

/** Taro H5 每个页面一个 .taro_page，切 tab 时旧页面隐藏；取当前可见的那个 */
const visiblePage = (page: Page) => page.locator('.taro_page:visible').last()

test.describe('未登录：门头页 → 登录页', () => {
  test.beforeEach(async ({ context }) => {
    await installMockApi(context, 'newUser')
  })

  test('打开根路径先看到门头页', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/#\/pages\/landing\/index/)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('练成')
    await expect(page.locator('.ld-icp')).toHaveAttribute('href', 'https://beian.miit.gov.cn/')
  })

  test('直接打开应用内页面仍先去登录页（authGuard）', async ({ page }) => {
    await page.goto('/#/pages/mastery/index')
    await expect(page).toHaveURL(/#\/pages\/login\/index/)
    await expect(visiblePage(page).locator('.login-title')).toHaveText('邮箱登录')
  })

  test('门头页点「登录 / 开始使用」进入登录页', async ({ page }) => {
    await page.goto('/')
    await page.locator('.ld-hero .ld-btn-primary').click()
    await expect(page).toHaveURL(/#\/pages\/login\/index/)
    await expect(visiblePage(page).locator('.login-title')).toHaveText('邮箱登录')
  })

  test('未勾协议点获取验证码 → 先弹同意确认，「暂不」不发送', async ({ page, context }) => {
    const calls = await installMockApi(context, 'newUser')
    await page.goto('/#/pages/login/index')
    const login = visiblePage(page)
    await login.locator('.login-col input').first().fill('someone@example.com')
    await login.locator('.btn-code').click()
    await expect(page.getByText('请先同意协议')).toBeVisible()
    await page.locator('.taro-model__cancel').click()
    await page.waitForTimeout(300)
    expect(calls.filter((c) => c.includes('/auth/email/send-code'))).toHaveLength(0)

    await login.locator('.btn-code').click()
    await page.locator('.taro-model__confirm').click()
    await expect.poll(() => calls.filter((c) => c.includes('/auth/email/send-code')).length).toBe(1)
  })

  test('邮箱验证码登录成功后进入应用首页（新用户三步引导）', async ({ page }) => {
    await page.goto('/#/pages/login/index')
    const login = visiblePage(page)
    await login.locator('.agree-hit').click()
    await login.locator('.login-col input').first().fill('someone@example.com')
    await login.locator('.btn-code').click()
    await login.locator('.login-col input').nth(1).fill('123456')
    await login.locator('.btn-login').click()
    await expect(page).toHaveURL(/#\/pages\/index\/index/)
    await expect(visiblePage(page).locator('.zx-onb-title')).toBeVisible()
  })
})

test.describe('已登录（mock token）', () => {
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(LOGIN_INIT_SCRIPT)
  })

  test('根路径直接进应用首页；新用户看到空状态引导与「示意」标注', async ({ page, context }) => {
    await installMockApi(context, 'newUser')
    await page.goto('/')
    await expect(page).not.toHaveURL(/pages\/(landing|login)\/index/)
    const home = visiblePage(page)
    await expect(home.locator('.zx-onb-title')).toHaveText('三步开始你的第一轮练习')
    await expect(home.locator('.zx-onb-tag').first()).toHaveText('示意')
    await expect(home.locator('.home-overview-card')).toHaveCount(0)
  })

  test('门头页对已登录用户仍可访问，点开始使用回到应用首页', async ({ page, context }) => {
    await installMockApi(context, 'withData')
    await page.goto('/#/pages/landing/index')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await page.locator('.ld-hero .ld-btn-primary').click()
    await expect(page).toHaveURL(/#\/pages\/index\/index/)
  })

  test('手机：底部 Dock 四个 tab 依次切换', async ({ page, context }) => {
    await installMockApi(context, 'withData')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/#/pages/index/index')
    const expectations: Array<[string, RegExp, string]> = [
      ['口袋', /pages\/knowledge\/index/, '.knowledge-page'],
      ['曲线', /pages\/mastery\/index/, '.mastery-page'],
      ['我的', /pages\/profile\/index/, '.profile-page'],
      ['今日', /pages\/index\/index/, '.index-page'],
    ]
    for (const [label, url, cls] of expectations) {
      await visiblePage(page).locator(`.zx-dock-tab[aria-label="${label}"]`).click()
      await expect(page).toHaveURL(url)
      await expect(visiblePage(page).locator(cls)).toBeVisible()
    }
  })

  test('宽屏：左侧侧栏四个入口依次切换', async ({ page, context }) => {
    await installMockApi(context, 'withData')
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/#/pages/index/index')
    for (const [label, url] of [
      ['口袋', /pages\/knowledge\/index/],
      ['曲线', /pages\/mastery\/index/],
      ['我的', /pages\/profile\/index/],
      ['今日', /pages\/index\/index/],
    ] as Array<[string, RegExp]>) {
      await visiblePage(page).locator(`.zx-sn-item[aria-label="${label}"]`).click()
      await expect(page).toHaveURL(url)
    }
  })
})

/* ---------- 备案页脚与排布：三种尺寸下贴底、可见、不被 Dock 挡、无横向滚动 ---------- */
const VIEWPORTS = [
  { name: '手机 390', width: 390, height: 844 },
  { name: 'iPad 竖屏 1032×1376', width: 1032, height: 1376 },
  { name: '桌面 1440', width: 1440, height: 900 },
]
const APP_PAGES = ['index', 'knowledge', 'mastery', 'profile']

async function scrollToBottom(page: Page) {
  await page.evaluate(() => {
    const els = [document.scrollingElement, ...document.querySelectorAll('.taro_page, .taro-tabbar__panel')]
    els.forEach((el) => {
      if (el && el.scrollHeight > el.clientHeight) el.scrollTop = el.scrollHeight
    })
    window.scrollTo(0, document.body.scrollHeight)
  })
  await page.waitForTimeout(250)
}

async function expectIcpAtBottom(page: Page, selector: string) {
  const icp = visiblePage(page).locator(selector).first()
  await expect(icp).toBeVisible()
  await expect(icp).toHaveText('浙ICP备2026102405号-1')
  await scrollToBottom(page)
  const vp = page.viewportSize()!
  const box = (await icp.boundingBox())!
  // 在视口内
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 1)
  // 贴底：页脚下方剩余空间不超过底部 Dock / 安全区留白
  expect(vp.height - (box.y + box.height)).toBeLessThan(vp.width < 1100 ? 160 : 60)
  // 不被底部 Dock 遮挡
  const dock = visiblePage(page).locator('.zx-dock-pill')
  if (await dock.isVisible().catch(() => false)) {
    const d = (await dock.boundingBox())!
    expect(box.y + box.height).toBeLessThanOrEqual(d.y + 1)
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
}

for (const vp of VIEWPORTS) {
  test.describe(`排布 · ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } })

    test('门头页：备案号在页脚并链接工信部', async ({ page, context }) => {
      await installMockApi(context, 'newUser')
      await page.goto('/#/pages/landing/index')
      await expectIcpAtBottom(page, '.ld-icp')
    })

    test('登录页：备案号贴底', async ({ page, context }) => {
      await installMockApi(context, 'newUser')
      await page.goto('/#/pages/login/index')
      await expectIcpAtBottom(page, '.zx-icp-link')
    })

    for (const profile of ['newUser', 'withData'] as const) {
      for (const p of APP_PAGES) {
        test(`${profile} · ${p}：备案号贴底且不被 Dock 遮挡`, async ({ page, context }) => {
          await context.addInitScript(LOGIN_INIT_SCRIPT)
          await installMockApi(context, profile)
          await page.goto(`/#/pages/${p}/index`)
          await expect(visiblePage(page).locator('.zx-rpage')).toBeVisible()
          await expectIcpAtBottom(page, '.zx-icp-link')
        })
      }
    }
  })
}
