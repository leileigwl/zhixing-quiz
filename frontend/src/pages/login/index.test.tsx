import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Taro from '@tarojs/taro'
import LoginPage from './index'

const requestMock = () => vi.mocked(Taro.request)
const ok = <T,>(data: T) => ({ statusCode: 200, data: { code: 0, message: 'ok', data } })
const fail = (statusCode: number, code: number, message: string) => ({
  statusCode,
  data: { code, message, data: null },
})

const flush = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function setup() {
  const utils = render(<LoginPage />)
  const [emailInput, codeInput] = utils.container.querySelectorAll('input')
  const typeEmail = (v: string) => fireEvent.change(emailInput, { target: { value: v } })
  const typeCode = (v: string) => fireEvent.change(codeInput, { target: { value: v } })
  const codeBtn = () => utils.container.querySelector('.btn-code') as HTMLElement
  const loginBtn = () => utils.container.querySelector('.btn-login') as HTMLElement
  const agree = () => utils.container.querySelector('.agree-hit') as HTMLElement
  return { ...utils, emailInput, codeInput, typeEmail, typeCode, codeBtn, loginBtn, agree }
}

describe('LoginPage（H5 邮箱验证码登录）', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false })
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('邮箱非法时就地提示，不发请求', async () => {
    const ui = setup()
    ui.typeEmail('not-email')
    fireEvent.click(ui.codeBtn())
    await flush()
    expect(screen.getByText('请输入正确的邮箱地址')).toBeTruthy()
    expect(requestMock()).not.toHaveBeenCalled()
  })

  it('发码成功 → 60s 倒计时 → 输入验证码并同意协议 → 登录成功保存 token 并回到首页', async () => {
    const ui = setup()
    requestMock()
      .mockResolvedValueOnce(ok({ message: '已发送', cooldown_seconds: 60, expires_in_seconds: 600 }) as any)
      .mockResolvedValueOnce(
        ok({ token: 'jwt-ok', user: { id: 1, nickname: '学习者', avatar_url: '', total_xp: 0, streak_days: 0 } }) as any,
      )

    ui.typeEmail('Julia@163.com')
    fireEvent.click(ui.codeBtn())
    await flush()
    expect(ui.codeBtn().textContent).toBe('重新获取 (60s)')
    expect(ui.codeBtn().className).toContain('is-disabled')
    expect(screen.getByText('ju***@163.com')).toBeTruthy()

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(ui.codeBtn().textContent).toBe('重新获取 (59s)')

    // 倒计时中再次点击不会重复发送
    fireEvent.click(ui.codeBtn())
    await flush()
    expect(requestMock()).toHaveBeenCalledTimes(1)

    ui.typeCode('12a3456')
    expect((ui.codeInput as HTMLInputElement).value).toBe('123456')

    // 未勾选协议：提示并不发请求
    fireEvent.click(ui.loginBtn())
    await flush()
    expect(screen.getByText('请先阅读并同意用户协议与隐私政策')).toBeTruthy()
    expect(requestMock()).toHaveBeenCalledTimes(1)

    fireEvent.click(ui.agree())
    fireEvent.click(ui.loginBtn())
    await flush()

    expect(requestMock()).toHaveBeenCalledTimes(2)
    expect((requestMock().mock.calls[1][0] as any).data).toEqual({ email: 'julia@163.com', code: '123456' })
    expect(Taro.getStorageSync('zx_token')).toBe('jwt-ok')
    expect(Taro.reLaunch).toHaveBeenCalledWith({ url: '/pages/index/index' })
  })

  it('验证码错误显示剩余次数；次数超限清空验证码并允许立即重新获取', async () => {
    const ui = setup()
    requestMock()
      .mockResolvedValueOnce(ok({ message: '已发送', cooldown_seconds: 60, expires_in_seconds: 600 }) as any)
      .mockResolvedValueOnce(fail(400, 4012, '验证码错误，还可尝试 4 次') as any)
      .mockResolvedValueOnce(fail(400, 4013, '验证码错误次数过多，请重新获取') as any)

    ui.typeEmail('a@qq.com')
    fireEvent.click(ui.codeBtn())
    await flush()
    fireEvent.click(ui.agree())
    ui.typeCode('000000')
    fireEvent.click(ui.loginBtn())
    await flush()
    expect(screen.getByText('验证码错误，还可尝试 4 次')).toBeTruthy()
    expect(Taro.reLaunch).not.toHaveBeenCalled()

    fireEvent.click(ui.loginBtn())
    await flush()
    expect(screen.getByText('验证码错误次数过多，请重新获取')).toBeTruthy()
    expect((ui.codeInput as HTMLInputElement).value).toBe('')
    expect(ui.codeBtn().textContent).toBe('重新获取')
    expect(ui.codeBtn().className).not.toContain('is-disabled')
  })

  it('发送过于频繁（429）显示顶部提示条，2.4s 后收起', async () => {
    const ui = setup()
    requestMock().mockResolvedValueOnce(fail(429, 4290, '验证码发送过于频繁，请 60 秒后再试') as any)
    ui.typeEmail('a@qq.com')
    fireEvent.click(ui.codeBtn())
    await flush()
    const banner = ui.container.querySelector('.login-banner') as HTMLElement
    expect(banner.className).toContain('is-show')
    expect(banner.textContent).toBe('验证码发送过于频繁，请 60 秒后再试')
    expect(ui.codeBtn().textContent).toBe('获取验证码')

    act(() => {
      vi.advanceTimersByTime(2400)
    })
    expect(banner.className).not.toContain('is-show')
  })

  it('协议链接打开占位说明', () => {
    const ui = setup()
    fireEvent.click(screen.getByText('《隐私政策》'))
    expect(Taro.showModal).toHaveBeenCalledWith(expect.objectContaining({ title: '隐私政策' }))
    expect(ui.container.querySelector('.agree-check')?.className).not.toContain('is-on')
  })
})
