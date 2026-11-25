import { useEffect, useRef, useState } from 'react'
import Taro from '@tarojs/taro'
import { View, Text, Input } from '@tarojs/components'
import { HOME_PAGE_URL, sendEmailCode, verifyEmailCode } from '../../services/api'
import {
  DEFAULT_COOLDOWN_SECONDS,
  MSG,
  canRequestCode,
  canSubmit,
  getCodeButtonLabel,
  isValidCode,
  isValidEmail,
  mapAuthError,
  maskEmail,
  sanitizeCode,
  type AuthErrorLike,
} from '../../services/emailLogin'
import { useCountdown } from '../../services/useCountdown'
import './index.scss'

const BANNER_MS = 2400
/** 按下态至少保持 90ms（V2.7 点按手感规范），快速轻点也能看见反馈 */
const PRESS_STAY_MS = 90

/**
 * H5 邮箱验证码登录页（对照 docs/02-design/prototypes/v28-email-login.html）。
 * 小程序端不会进入本页（weapp 走 wx.login 静默登录）。
 */
export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(false)
  const [sentTo, setSentTo] = useState('')
  const [emailError, setEmailError] = useState('')
  const [codeError, setCodeError] = useState('')
  const [banner, setBanner] = useState('')
  const [nudgeAgree, setNudgeAgree] = useState(false)
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const countdown = useCountdown()

  useEffect(() => {
    return () => {
      if (bannerTimer.current) clearTimeout(bannerTimer.current)
    }
  }, [])

  const showBanner = (message: string) => {
    setBanner(message)
    if (bannerTimer.current) clearTimeout(bannerTimer.current)
    bannerTimer.current = setTimeout(() => setBanner(''), BANNER_MS)
  }

  const applyError = (err: unknown) => {
    const view = mapAuthError(err as AuthErrorLike)
    if (view.clearCode) setCode('')
    if (view.resetCountdown) countdown.reset()
    if (view.target === 'email') setEmailError(view.message)
    else if (view.target === 'code') setCodeError(view.message)
    else showBanner(view.message)
  }

  const handleEmailInput = (value: string) => {
    setEmail(value)
    if (emailError) setEmailError('')
  }

  const handleEmailBlur = () => {
    if (email && !isValidEmail(email)) setEmailError(MSG.invalidEmail)
  }

  const handleCodeInput = (value: string) => {
    const next = sanitizeCode(value)
    setCode(next)
    if (codeError) setCodeError('')
    return next
  }

  const handleSendCode = async () => {
    if (sending || countdown.running) return
    if (!isValidEmail(email)) {
      setEmailError(MSG.invalidEmail)
      return
    }
    if (!canRequestCode({ email, sending, remaining: countdown.remaining })) return
    setSending(true)
    setCodeError('')
    try {
      const res = await sendEmailCode(email)
      setSentTo(maskEmail(email))
      countdown.start(res?.cooldown_seconds || DEFAULT_COOLDOWN_SECONDS)
    } catch (err) {
      applyError(err)
    } finally {
      setSending(false)
    }
  }

  const handleLogin = async () => {
    if (loading) return
    if (!isValidEmail(email)) {
      setEmailError(MSG.invalidEmail)
      return
    }
    if (!isValidCode(code)) {
      setCodeError(MSG.invalidCode)
      return
    }
    if (!agreed) {
      setNudgeAgree(false)
      setTimeout(() => setNudgeAgree(true), 0)
      showBanner(MSG.needAgree)
      return
    }
    setLoading(true)
    try {
      await verifyEmailCode(email, code)
      Taro.reLaunch({ url: HOME_PAGE_URL })
    } catch (err) {
      applyError(err)
    } finally {
      setLoading(false)
    }
  }

  const openAgreement = (title: string) => {
    void Taro.showModal({
      title,
      content: `${title}正文整理中，正式上线前补充。`,
      showCancel: false,
      confirmText: '知道了',
    })
  }

  const codeBtnDisabled = sending || countdown.running
  const submitReady = canSubmit({ email, code, loading })

  return (
    <View className='login-page'>
      <View className={`login-banner ${banner ? 'is-show' : ''}`}>
        <Text>{banner}</Text>
      </View>

      <View className='login-brand'>
        <View className='brand-mark'>
          <View className='brand-mark-sky' />
          <View className='brand-mark-butter' />
          <View className='brand-mark-dot' />
        </View>
        <Text className='brand-name'>知行快刷</Text>
      </View>
      <Text className='login-title'>邮箱登录</Text>
      <Text className='login-sub'>输入邮箱获取验证码，首次登录将自动创建账号，学习记录跨设备同步。</Text>

      <View className='login-card'>
        <Text className='field-label'>邮箱</Text>
        <View className={`field ${emailError ? 'has-error' : ''}`}>
          <Input
            className='field-input'
            type='text'
            value={email}
            maxlength={254}
            placeholder='name@163.com'
            placeholderClass='field-placeholder'
            onInput={(e) => handleEmailInput(e.detail.value)}
            onBlur={handleEmailBlur}
            onConfirm={handleSendCode}
          />
          {email ? (
            <View
              className='field-clear'
              hoverClass='is-pressed'
              hoverStayTime={PRESS_STAY_MS}
              onClick={() => handleEmailInput('')}
            >
              <Text>✕</Text>
            </View>
          ) : null}
        </View>
        <Text className='field-error'>{emailError}</Text>

        <Text className='field-label'>验证码</Text>
        <View className='code-row'>
          <View className={`field code-field ${codeError ? 'has-error' : ''}`}>
            <Input
              className='field-input code-input'
              type='number'
              value={code}
              maxlength={6}
              placeholder='6 位数字'
              placeholderClass='field-placeholder'
              onInput={(e) => handleCodeInput(e.detail.value)}
              onConfirm={handleLogin}
            />
          </View>
          <View
            className={`btn-code ${codeBtnDisabled ? 'is-disabled' : ''}`}
            hoverClass={codeBtnDisabled ? 'none' : 'is-pressed'}
            hoverStayTime={PRESS_STAY_MS}
            onClick={handleSendCode}
          >
            <Text>{getCodeButtonLabel({ sending, remaining: countdown.remaining, hasSent: !!sentTo })}</Text>
          </View>
        </View>
        <Text className='field-error'>{codeError}</Text>

        {sentTo ? (
          <View className='sent-tip'>
            <Text>
              验证码已发送至 <Text className='sent-tip-strong'>{sentTo}</Text>，10 分钟内有效
            </Text>
          </View>
        ) : null}

        <View className={`agree-row ${nudgeAgree ? 'is-nudge' : ''}`}>
          <View
            className='agree-hit'
            hoverClass='is-pressed'
            hoverStayTime={PRESS_STAY_MS}
            onClick={() => {
              setAgreed((v) => !v)
              setNudgeAgree(false)
            }}
          >
            <View className={`agree-check ${agreed ? 'is-on' : ''}`} />
          </View>
          <View className='agree-text'>
            <Text>我已阅读并同意 </Text>
            <Text className='agree-link' onClick={() => openAgreement('用户协议')}>
              《用户协议》
            </Text>
            <Text> 和 </Text>
            <Text className='agree-link' onClick={() => openAgreement('隐私政策')}>
              《隐私政策》
            </Text>
          </View>
        </View>

        <View
          className={`btn-login ${submitReady ? '' : 'is-disabled'}`}
          hoverClass={loading ? 'none' : 'is-pressed'}
          hoverStayTime={PRESS_STAY_MS}
          onClick={handleLogin}
        >
          <Text>{loading ? '登录中…' : '登录'}</Text>
          {loading ? <View className='btn-spinner' /> : <Text className='btn-arrow'>→</Text>}
        </View>
      </View>

      <Text className='login-foot'>收不到邮件？请检查垃圾邮件箱，或 60 秒后重新获取</Text>
    </View>
  )
}
