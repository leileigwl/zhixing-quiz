/**
 * 邮箱验证码登录的纯逻辑层（无 Taro 依赖，便于单测）：
 * 邮箱/验证码校验、倒计时计算、按钮文案、后端错误 → 界面状态映射。
 * 交互规范见 docs/02-design/prototypes/v28-email-login.html。
 */

export const CODE_LENGTH = 6
export const DEFAULT_COOLDOWN_SECONDS = 60
export const MAX_EMAIL_LENGTH = 254

/**
 * 邮箱格式：不限邮箱服务商（QQ / 163 / Gmail / Outlook / 企业邮箱 / 学校邮箱 / 中文域名均可）。
 * 与后端 app/services/email_otp_service.py 的规则保持一致：
 * - 本地部分：RFC 5322 dot-atom 允许的 ASCII 字符（字母数字与 !#$%&'*+/=?^_`{|}~-，点不能打头/结尾/连续）；
 * - 域名：每段 1–63 个字母/数字/连字符（不以连字符开头或结尾），允许中文等非 ASCII 字符（后端转 punycode）；
 * - 顶级域：至少 2 个字母，或 punycode 形式 xn--…，或非 ASCII 顶级域（如 .中国）。
 */
const LOCAL_RE = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/
// 不用后行断言（iOS Safari < 16.4 不支持）
const LABEL_RE = /^[A-Za-z0-9\u0080-\uFFFF]([A-Za-z0-9\u0080-\uFFFF-]{0,61}[A-Za-z0-9\u0080-\uFFFF])?$/
const TLD_RE = /^([A-Za-z]{2,63}|xn--[A-Za-z0-9-]{1,59}|[\u0080-\uFFFF]{1,63})$/

export const MSG = {
  invalidEmail: '请输入正确的邮箱地址',
  invalidCode: `请输入 ${CODE_LENGTH} 位数字验证码`,
  needAgree: '请先阅读并同意用户协议与隐私政策',
  network: '网络连接失败，请检查网络后重试',
  unknown: '登录失败，请稍后重试',
  tooManyAttempts: '验证码错误次数过多，请重新获取',
} as const

/** 后端业务错误码（见 backend/app/main.py 异常处理器） */
export const AUTH_ERROR_CODE = {
  invalidEmail: 4011,
  invalidOrExpired: 4012,
  tooManyAttempts: 4013,
  rateLimited: 4290,
  unavailable: 5030,
} as const

/**
 * 去空格、全角转半角（中文输入法常打出「＠」「．」「。」）、小写。
 * 与后端 normalize 前的预处理一致：NFKC + 句号「。｡」→「.」。
 */
export function normalizeEmail(raw: string): string {
  let s = String(raw || '')
  // 极老内核没有 String#normalize 时跳过（仍可正常输入半角邮箱）
  if (typeof s.normalize === 'function') s = s.normalize('NFKC')
  s = s.replace(/[\u3002\uFF61]/g, '.')
  return s.trim().toLowerCase()
}

export function isValidEmail(raw: string): boolean {
  const email = normalizeEmail(raw)
  if (!email || email.length > MAX_EMAIL_LENGTH) return false
  const at = email.lastIndexOf('@')
  if (at <= 0 || at !== email.indexOf('@')) return false
  const local = email.slice(0, at)
  const domain = email.slice(at + 1)
  if (local.length > 64 || !LOCAL_RE.test(local)) return false
  const labels = domain.split('.')
  if (labels.length < 2 || domain.length > 253) return false
  if (!labels.every((l) => LABEL_RE.test(l))) return false
  return TLD_RE.test(labels[labels.length - 1])
}

/** 只保留数字并截断到 6 位（粘贴「验证码：123 456」也能正确填入） */
export function sanitizeCode(raw: string): string {
  return (raw || '').replace(/\D/g, '').slice(0, CODE_LENGTH)
}

export function isValidCode(code: string): boolean {
  return new RegExp(`^\\d{${CODE_LENGTH}}$`).test(code)
}

/** 提示文案脱敏：julia@163.com → ju***@163.com */
export function maskEmail(raw: string): string {
  const email = normalizeEmail(raw)
  const at = email.indexOf('@')
  if (at <= 0) return email
  return `${email.slice(0, Math.min(2, at))}***${email.slice(at)}`
}

/* ---------------- 倒计时 ---------------- */

/** 剩余秒数（向上取整，结束后恒为 0）；endsAt/now 均为毫秒时间戳 */
export function remainingSeconds(endsAt: number, now: number): number {
  if (!endsAt || now >= endsAt) return 0
  return Math.ceil((endsAt - now) / 1000)
}

export function getCodeButtonLabel(state: { sending: boolean; remaining: number; hasSent: boolean }): string {
  if (state.sending) return '发送中…'
  if (state.remaining > 0) return `重新获取 (${state.remaining}s)`
  return state.hasSent ? '重新获取' : '获取验证码'
}

export function canRequestCode(state: { email: string; sending: boolean; remaining: number }): boolean {
  return !state.sending && state.remaining <= 0 && isValidEmail(state.email)
}

export function canSubmit(state: { email: string; code: string; loading: boolean }): boolean {
  return !state.loading && isValidEmail(state.email) && isValidCode(state.code)
}

/* ---------------- 错误映射 ---------------- */

export interface AuthErrorLike {
  /** 后端业务码（ApiResponse.code）；网络异常时为 undefined */
  code?: number
  statusCode?: number
  message?: string
}

export interface AuthErrorView {
  /** 错误展示位置：邮箱输入框下 / 验证码输入框下 / 顶部提示条 */
  target: 'email' | 'code' | 'banner'
  message: string
  /** 需要清空验证码输入框（验证码已作废） */
  clearCode?: boolean
  /** 需要立即结束倒计时，允许马上重新获取 */
  resetCountdown?: boolean
}

export function mapAuthError(err: AuthErrorLike | null | undefined): AuthErrorView {
  const code = err?.code
  const message = (err?.message || '').trim()

  if (code === undefined || code === null) {
    return { target: 'banner', message: MSG.network }
  }
  switch (code) {
    case AUTH_ERROR_CODE.invalidEmail:
      return { target: 'email', message: message || MSG.invalidEmail }
    case AUTH_ERROR_CODE.invalidOrExpired:
      return { target: 'code', message: message || '验证码错误或已过期' }
    case AUTH_ERROR_CODE.tooManyAttempts:
      return { target: 'code', message: message || MSG.tooManyAttempts, clearCode: true, resetCountdown: true }
    case AUTH_ERROR_CODE.rateLimited:
      return { target: 'banner', message: message || '操作过于频繁，请稍后再试' }
    case AUTH_ERROR_CODE.unavailable:
      return { target: 'banner', message: message || '服务暂不可用，请稍后再试' }
    default:
      return { target: 'banner', message: message || MSG.unknown }
  }
}
