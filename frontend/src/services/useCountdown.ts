import { useCallback, useEffect, useRef, useState } from 'react'
import { remainingSeconds } from './emailLogin'

/**
 * 验证码按钮倒计时 Hook：以「结束时间戳」为准计算剩余秒数，
 * 页面切后台 / 定时器被节流后回来也不会走慢；剩余为 0 时自动停表。
 */
export function useCountdown(now: () => number = Date.now) {
  const nowRef = useRef(now)
  nowRef.current = now
  const [endsAt, setEndsAt] = useState(0)
  const [remaining, setRemaining] = useState(0)

  useEffect(() => {
    if (!endsAt) return undefined
    const tick = () => {
      const left = remainingSeconds(endsAt, nowRef.current())
      setRemaining(left)
      if (left <= 0) {
        clearInterval(timer)
        setEndsAt(0)
      }
    }
    const timer = setInterval(tick, 250)
    tick()
    return () => clearInterval(timer)
  }, [endsAt])

  const start = useCallback((seconds: number) => {
    const sec = Math.max(0, Math.floor(seconds))
    setRemaining(sec)
    setEndsAt(sec > 0 ? nowRef.current() + sec * 1000 : 0)
  }, [])

  const reset = useCallback(() => {
    setEndsAt(0)
    setRemaining(0)
  }, [])

  return { remaining, running: remaining > 0, start, reset }
}
