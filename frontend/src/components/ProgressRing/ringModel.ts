/** 进度环纯逻辑：把可能缺失 / 越界的百分比规整成 0–100 的整数；无数据返回 null（显示「—」而不是 0%） */
export function normalizePercent(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  return Math.round(Math.min(100, Math.max(0, value)))
}

/** conic-gradient 背景：有值时 from→to 渐变扫过 p%，其余为底色；无值时整圈底色 */
export function ringBackground(p: number | null, from: string, to: string, track: string): string {
  if (p === null || p <= 0) return `conic-gradient(${track} 0 100%)`
  return `conic-gradient(${from} 0%, ${to} ${p}%, ${track} ${p}% 100%)`
}
