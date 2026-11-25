/**
 * 侧栏「今日」项的待巩固计数：由首页 / 曲线页拿到真实数据后写入，侧栏订阅显示。
 * 不额外发请求；未写入过时为 null（不显示徽标）。
 */
type Listener = (count: number | null) => void

let current: number | null = null
const listeners = new Set<Listener>()

export function getNavDueCount(): number | null {
  return current
}

export function setNavDueCount(count: number | null | undefined) {
  const next = typeof count === 'number' && Number.isFinite(count) && count >= 0 ? Math.floor(count) : null
  if (next === current) return
  current = next
  listeners.forEach((fn) => fn(current))
}

export function subscribeNavDueCount(fn: Listener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** 徽标文案：0 或未知不显示，超过 99 显示 99+ */
export function formatNavDueCount(count: number | null): string {
  if (!count || count <= 0) return ''
  return count > 99 ? '99+' : String(count)
}
