import type { WeeklyRhythmDay } from '../../services/api'

/** 本周 7 日节律柱图的纯数据准备层（无 Taro 依赖，可单测）。视觉参数与原组件逐一对齐。 */

/** 柱轨道像素高度与底部标签区高度（与 index.scss 中 .zx-bar-track / 标签胶囊保持一致） */
export const BAR_TRACK_PX = 116
export const BAR_LABEL_OFFSET_PX = 44

export interface RhythmBar {
  day: WeeklyRhythmDay
  count: number
  /** 柱高百分比：0 题 8%（占位），最大值 100%，其余按比例并夹在 [22, 96] */
  heightPct: number
  fillState: 'is-today' | 'is-active' | ''
  label: string
}

export interface RhythmModel {
  bars: RhythmBar[]
  maxVal: number
  totalVal: number
  activeDays: number
  avgVal: number
  /** 周均线相对柱高的百分比（无活跃日为 0 = 不画） */
  avgLineBottomPct: number
  /** 周均线的 CSS bottom 值（无则 null） */
  avgLineBottomCss: string | null
}

export function computeBarHeightPct(count: number, maxVal: number): number {
  if (count <= 0) return 8
  if (count === maxVal) return 100
  return Math.max(22, Math.min(96, Math.round((count / maxVal) * 100)))
}

export function buildRhythmModel(days: WeeklyRhythmDay[]): RhythmModel {
  const safeDays = (days || []).slice(0, 7)
  const counts = safeDays.map((d) => d.completed_count || 0)
  const maxVal = Math.max(1, ...counts)
  const totalVal = counts.reduce((s, v) => s + v, 0)
  const activeDays = counts.filter((c) => c > 0).length
  const avgVal = activeDays > 0 ? totalVal / activeDays : 0
  const avgLineBottomPct =
    avgVal > 0 ? Math.max(14, Math.min(92, Math.round((avgVal / maxVal) * 100))) : 0

  const bars: RhythmBar[] = safeDays.map((day, idx) => {
    const count = counts[idx]
    return {
      day,
      count,
      heightPct: computeBarHeightPct(count, maxVal),
      fillState: day.is_today ? 'is-today' : count > 0 ? 'is-active' : '',
      label: day.is_today ? '今' : day.day_label,
    }
  })

  return {
    bars,
    maxVal,
    totalVal,
    activeDays,
    avgVal,
    avgLineBottomPct,
    avgLineBottomCss:
      avgLineBottomPct > 0
        ? `calc(${BAR_LABEL_OFFSET_PX}px + ${Math.round((avgLineBottomPct / 100) * BAR_TRACK_PX)}px)`
        : null,
  }
}
