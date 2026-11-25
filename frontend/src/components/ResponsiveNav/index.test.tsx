import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Taro from '@tarojs/taro'
import ResponsiveNav from './index'
import IcpFooter, { ICP_NUMBER, ICP_URL } from '../IcpFooter'
import { FOCUS_COMPOSER_EVENT, startNewQuiz } from '../SideNav'
import { setNavDueCount } from '../SideNav/navBadge'

function setWidth(width: number) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (q: string) => ({
      matches: width >= Number(/(\d+)px/.exec(q)?.[1]),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  })
}

describe('ResponsiveNav（V2.9：手机 / iPad 竖屏用底部 Dock，宽屏用侧栏）', () => {
  afterEach(() => {
    cleanup()
    // @ts-expect-error 测试清理
    delete window.matchMedia
  })

  it.each([390, 820, 1099])('%i px 渲染底部 Dock，不渲染侧栏', (w) => {
    setWidth(w)
    const { container } = render(<ResponsiveNav activeKey='index' />)
    expect(container.querySelector('.zx-dock-pill')).toBeTruthy()
    expect(container.querySelector('.zx-sidenav')).toBeNull()
  })

  it.each([1100, 1440])('%i px 渲染侧栏：品牌、4 项导航、当前项高亮', (w) => {
    setWidth(w)
    const { container } = render(<ResponsiveNav activeKey='mastery' />)
    expect(container.querySelector('.zx-dock-pill')).toBeNull()
    const items = container.querySelectorAll('.zx-sn-item')
    expect(Array.from(items).map((i) => i.textContent)).toEqual(['今日', '口袋', '曲线', '我的'])
    expect(container.querySelector('.zx-sn-item.is-active')?.textContent).toBe('曲线')
    expect(screen.getByText('知行快刷')).toBeTruthy()
  })

  it('侧栏点导航项 switchTab，点当前项不跳；显示登录邮箱与待巩固数', () => {
    setWidth(1440)
    Taro.setStorageSync('zx_user_info', { id: 1, nickname: '林同学', avatar_url: '', total_xp: 0 })
    Taro.setStorageSync('zx_login_email', 'lin@example.com')
    const { container } = render(<ResponsiveNav activeKey='index' />)
    act(() => setNavDueCount(3))
    expect(container.querySelector('.zx-sn-count')?.textContent).toBe('3')
    expect(screen.getByText('林同学')).toBeTruthy()
    expect(screen.getByText('lin@example.com')).toBeTruthy()

    fireEvent.click(screen.getByText('口袋'))
    expect(Taro.switchTab).toHaveBeenCalledWith({ url: '/pages/knowledge/index' })
    vi.mocked(Taro.switchTab).mockClear()
    fireEvent.click(screen.getByText('今日'))
    expect(Taro.switchTab).not.toHaveBeenCalled()
    act(() => setNavDueCount(0))
    expect(container.querySelector('.zx-sn-count')).toBeNull()
  })

  it('「+ 发起新测验」：不在首页时先切到首页，再发聚焦事件', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    Taro.eventCenter.on(FOCUS_COMPOSER_EVENT, fn)
    startNewQuiz('profile')
    expect(Taro.switchTab).toHaveBeenCalledWith({ url: '/pages/index/index' })
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(150)
    expect(fn).toHaveBeenCalledTimes(1)

    vi.mocked(Taro.switchTab).mockClear()
    startNewQuiz('index')
    vi.advanceTimersByTime(1)
    expect(Taro.switchTab).not.toHaveBeenCalled()
    expect(fn).toHaveBeenCalledTimes(2)
    Taro.eventCenter.off(FOCUS_COMPOSER_EVENT, fn)
  })
})

describe('IcpFooter', () => {
  afterEach(cleanup)

  it('H5 显示备案号并在新窗口打开工信部网站', () => {
    render(<IcpFooter />)
    const link = screen.getByText(ICP_NUMBER) as HTMLAnchorElement
    expect(ICP_NUMBER).toBe('浙ICP备2026102405号-1')
    expect(link.getAttribute('href')).toBe(ICP_URL)
    expect(ICP_URL).toBe('https://beian.miit.gov.cn/')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
  })
})
