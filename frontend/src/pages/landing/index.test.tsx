import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import Taro from '@tarojs/taro'
import { afterEach, describe, expect, it } from 'vitest'
import LandingPage from './index'
import { LANDING_FACTS, LANDING_FEATURES, LANDING_STEPS } from './content'

describe('LandingPage（V3.0 门头页）', () => {
  afterEach(cleanup)

  it('包含品牌主张、四个核心功能、三步流程与备案号页脚', () => {
    const { container } = render(<LandingPage />)
    expect(container.querySelector('h1')?.textContent).toContain('记得住')
    expect(container.querySelectorAll('.ld-feature')).toHaveLength(LANDING_FEATURES.length)
    expect(container.querySelectorAll('.ld-step')).toHaveLength(LANDING_STEPS.length)
    expect(container.querySelectorAll('.ld-fact')).toHaveLength(LANDING_FACTS.length)
    const icp = container.querySelector('.ld-icp') as HTMLAnchorElement
    expect(icp.textContent).toBe('浙ICP备2026102405号-1')
    expect(icp.getAttribute('href')).toBe('https://beian.miit.gov.cn/')
    // 示意图明确标注
    expect(screen.getByText('界面示意')).toBeTruthy()
  })

  it('未登录点「登录 / 开始使用」进入登录页', () => {
    const { container } = render(<LandingPage />)
    fireEvent.click(container.querySelector('.ld-hero .ld-btn-primary')!)
    expect(Taro.navigateTo).toHaveBeenCalledWith({ url: '/pages/login/index' })
  })

  it('已登录点「登录 / 开始使用」直接回应用首页', () => {
    Taro.setStorageSync('zx_token', 'jwt-x')
    const { container } = render(<LandingPage />)
    fireEvent.click(container.querySelector('.ld-final .ld-btn')!)
    expect(Taro.reLaunch).toHaveBeenCalledWith({ url: '/pages/index/index' })
  })

  it('导航按钮滚动到对应分区', () => {
    const scrolled: string[] = []
    const orig = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.id)
    }
    const { container } = render(<LandingPage />)
    container.querySelectorAll('.ld-nav-links .ld-link').forEach((b) => fireEvent.click(b))
    expect(scrolled).toEqual(['ld-features', 'ld-steps', 'ld-curve'])
    Element.prototype.scrollIntoView = orig
  })
})
