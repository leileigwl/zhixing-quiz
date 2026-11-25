import { describe, expect, it } from 'vitest'
import {
  MSG,
  canRequestCode,
  canSubmit,
  getCodeButtonLabel,
  isValidCode,
  isValidEmail,
  mapAuthError,
  maskEmail,
  normalizeEmail,
  remainingSeconds,
  sanitizeCode,
} from './emailLogin'

describe('邮箱校验', () => {
  it.each(['a@163.com', ' Julia.P@QQ.com ', 'x+tag@mail.example.co'])('合法：%s', (email) => {
    expect(isValidEmail(email)).toBe(true)
  })

  it.each(['', 'abc', 'a@b', 'a@@b.com', 'a b@c.com', '.a@b.com', 'a.@b.com', 'a..b@c.com', `${'x'.repeat(65)}@a.com`, `a@${'b'.repeat(250)}.com`])(
    '非法：%s',
    (email) => {
      expect(isValidEmail(email)).toBe(false)
    },
  )

  it.each([
    'julia@gmail.com',
    'me@outlook.com',
    'first.last+tag@mail.company.com.cn',
    "o'brien@school.edu",
    'a_b-c@sub-domain.example.io',
    'user@example.technology',
    '1234567@qq.com',
    'me@例子.中国',
    'me@xn--fsqu00a.xn--fiqs8s',
    'ｊｕｌｉａ＠１６３。ｃｏｍ',
  ])('邮箱不限类型：%s', (email) => {
    expect(isValidEmail(email)).toBe(true)
  })

  it.each(['a@-b.com', 'a@b-.com', 'a@b.c', 'a@b.123', 'a@b..com'])('非法域名：%s', (email) => {
    expect(isValidEmail(email)).toBe(false)
  })

  it('normalizeEmail 全角转半角、中文句号转点', () => {
    expect(normalizeEmail('ｊｕｌｉａ＠１６３。ｃｏｍ')).toBe('julia@163.com')
  })

  it('normalizeEmail 去空格并小写', () => {
    expect(normalizeEmail('  A.B@QQ.COM ')).toBe('a.b@qq.com')
    expect(normalizeEmail(undefined as unknown as string)).toBe('')
  })

  it('maskEmail 脱敏', () => {
    expect(maskEmail('Julia@163.com')).toBe('ju***@163.com')
    expect(maskEmail('j@qq.com')).toBe('j***@qq.com')
    expect(maskEmail('no-at')).toBe('no-at')
  })
})

describe('验证码输入', () => {
  it('sanitizeCode 只留数字并截断 6 位', () => {
    expect(sanitizeCode('验证码：123 456')).toBe('123456')
    expect(sanitizeCode('12a34b5678')).toBe('123456')
    expect(sanitizeCode('')).toBe('')
  })

  it('isValidCode 必须正好 6 位数字', () => {
    expect(isValidCode('012345')).toBe(true)
    expect(isValidCode('12345')).toBe(false)
    expect(isValidCode('1234567')).toBe(false)
    expect(isValidCode('12345a')).toBe(false)
  })
})

describe('倒计时与按钮状态', () => {
  it('remainingSeconds 向上取整、结束后为 0', () => {
    expect(remainingSeconds(0, 1000)).toBe(0)
    expect(remainingSeconds(61_000, 1_000)).toBe(60)
    expect(remainingSeconds(61_000, 1_001)).toBe(60)
    expect(remainingSeconds(61_000, 60_001)).toBe(1)
    expect(remainingSeconds(61_000, 61_000)).toBe(0)
    expect(remainingSeconds(61_000, 99_000)).toBe(0)
  })

  it('getCodeButtonLabel', () => {
    expect(getCodeButtonLabel({ sending: false, remaining: 0, hasSent: false })).toBe('获取验证码')
    expect(getCodeButtonLabel({ sending: true, remaining: 0, hasSent: false })).toBe('发送中…')
    expect(getCodeButtonLabel({ sending: false, remaining: 42, hasSent: true })).toBe('重新获取 (42s)')
    expect(getCodeButtonLabel({ sending: false, remaining: 0, hasSent: true })).toBe('重新获取')
  })

  it('canRequestCode：邮箱合法且不在发送中 / 倒计时中', () => {
    expect(canRequestCode({ email: 'a@qq.com', sending: false, remaining: 0 })).toBe(true)
    expect(canRequestCode({ email: 'a@qq.com', sending: true, remaining: 0 })).toBe(false)
    expect(canRequestCode({ email: 'a@qq.com', sending: false, remaining: 3 })).toBe(false)
    expect(canRequestCode({ email: 'bad', sending: false, remaining: 0 })).toBe(false)
  })

  it('canSubmit：邮箱合法 + 6 位码 + 非加载中', () => {
    expect(canSubmit({ email: 'a@qq.com', code: '123456', loading: false })).toBe(true)
    expect(canSubmit({ email: 'a@qq.com', code: '12345', loading: false })).toBe(false)
    expect(canSubmit({ email: 'a@qq.com', code: '123456', loading: true })).toBe(false)
    expect(canSubmit({ email: 'a@', code: '123456', loading: false })).toBe(false)
  })
})

describe('mapAuthError 后端错误 → 界面', () => {
  it('网络错误（无 code）→ 顶部提示条', () => {
    expect(mapAuthError({ message: 'x' })).toEqual({ target: 'banner', message: MSG.network })
    expect(mapAuthError(null)).toEqual({ target: 'banner', message: MSG.network })
  })

  it('4011 → 邮箱输入框', () => {
    expect(mapAuthError({ code: 4011, message: '请输入正确的邮箱地址' })).toEqual({
      target: 'email',
      message: '请输入正确的邮箱地址',
    })
    expect(mapAuthError({ code: 4011 }).message).toBe(MSG.invalidEmail)
  })

  it('4012 → 验证码输入框，保留后端「还可尝试 N 次」文案', () => {
    expect(mapAuthError({ code: 4012, message: '验证码错误，还可尝试 3 次' })).toEqual({
      target: 'code',
      message: '验证码错误，还可尝试 3 次',
    })
    expect(mapAuthError({ code: 4012 }).message).toBe('验证码错误或已过期')
  })

  it('4013 → 清空验证码并结束倒计时', () => {
    expect(mapAuthError({ code: 4013, message: '' })).toEqual({
      target: 'code',
      message: MSG.tooManyAttempts,
      clearCode: true,
      resetCountdown: true,
    })
  })

  it('4290 / 5030 / 其它 → 顶部提示条', () => {
    expect(mapAuthError({ code: 4290, message: '验证码发送过于频繁，请 60 秒后再试' })).toEqual({
      target: 'banner',
      message: '验证码发送过于频繁，请 60 秒后再试',
    })
    expect(mapAuthError({ code: 4290 }).message).toBe('操作过于频繁，请稍后再试')
    expect(mapAuthError({ code: 5030 }).message).toBe('服务暂不可用，请稍后再试')
    expect(mapAuthError({ code: 5000, message: '服务器内部错误' })).toEqual({ target: 'banner', message: '服务器内部错误' })
    expect(mapAuthError({ code: 4000 }).message).toBe(MSG.unknown)
  })
})
