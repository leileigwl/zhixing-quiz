import { useEffect, useRef } from 'react'

const FOCUSABLE = 'textarea, input, select, button, a[href], [tabindex]:not([tabindex="-1"])'

/**
 * V2.9 弹层（仅 H5）：打开时按 Esc 关闭；打开后把焦点移到弹层内首个可聚焦控件，关闭后还给触发前的元素。
 * weapp 下不注册任何监听。
 * @param containerSelector 弹层根节点选择器（用于找首个可聚焦控件），可省略
 */
export function useEscClose(open: boolean, onClose: () => void, containerSelector?: string) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (process.env.TARO_ENV !== 'h5' || !open || typeof document === 'undefined') return undefined
    const trigger = document.activeElement as HTMLElement | null

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Esc') {
        e.preventDefault()
        onCloseRef.current()
      }
    }
    document.addEventListener('keydown', onKey)

    let focusTimer: ReturnType<typeof setTimeout> | null = null
    if (containerSelector) {
      focusTimer = setTimeout(() => {
        const root = document.querySelector(containerSelector)
        const first = root?.querySelector<HTMLElement>(FOCUSABLE)
        first?.focus?.()
      }, 0)
    }

    return () => {
      document.removeEventListener('keydown', onKey)
      if (focusTimer) clearTimeout(focusTimer)
      if (trigger && typeof trigger.focus === 'function' && document.contains(trigger)) {
        trigger.focus()
      }
    }
  }, [open, containerSelector])
}
