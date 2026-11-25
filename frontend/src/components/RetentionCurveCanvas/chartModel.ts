import type { RetentionCurvePoint } from '../../services/api'

/**
 * 记忆曲线画布的纯数据准备层（无 Canvas / Taro 依赖，可单测）。
 * drawRetentionChart 只负责按这里算好的坐标与文案下笔，视觉保持不变。
 */

/** 无真实数据（< 2 个点）时用于占位示意的形状；`isPlaceholder` 会标记出来，调用方不得把它当真实数据展示 */
export const PLACEHOLDER_POINTS: RetentionCurvePoint[] = [
  { day_label: '上次巩固', retention_pct: 84, baseline_pct: 84 },
  { day_label: '测前遗忘', retention_pct: 52, baseline_pct: 52, is_today: true },
  { day_label: '本次巩固', retention_pct: 86, baseline_pct: 42, is_recovery: true },
  { day_label: '+14天', retention_pct: 64, baseline_pct: 22 },
]

export const CHART_PADDING = { left: 16, right: 16, top: 24, bottom: 22 } as const

export interface ChartPointLayout {
  x: number
  y: number
  baselineY: number
  point: RetentionCurvePoint
}

export interface RetentionChartModel {
  isPlaceholder: boolean
  points: RetentionCurvePoint[]
  layout: ChartPointLayout[]
  chartW: number
  chartH: number
  y100: number
  y50: number
  hasBaseline: boolean
  todayIdx: number
  recoveryIdx: number
  /** 面积填充从哪个点开始（今日点优先，其次恢复点前一个） */
  activeStart: number
  /** 恢复点标注文案（无恢复点时为 null） */
  recoveryLabel: string | null
  /** X 轴三段标签：首 / 中（恢复点优先）/ 末 */
  axisLabels: Array<{ text: string; x: number }>
}

export function clampPct(pct: number): number {
  return Math.max(10, Math.min(100, pct))
}

export function buildRecoveryLabel(recovery: RetentionCurvePoint, pre: RetentionCurvePoint | null): string {
  const delta = pre ? Math.round(recovery.retention_pct - pre.retention_pct) : 0
  return delta > 0
    ? `巩固 ${Math.round(recovery.retention_pct)}% (+${delta}%)`
    : `保持 ${Math.round(recovery.retention_pct)}%`
}

/** 少于 2 个真实点时不画任何示意曲线（新用户空状态由页面负责，组件只兜底一行说明） */
export function hasDrawableCurve(points: RetentionCurvePoint[] | null | undefined): boolean {
  return Array.isArray(points) && points.length >= 2
}

export function prepareRetentionChart(
  points: RetentionCurvePoint[],
  width: number,
  height: number,
): RetentionChartModel {
  const isPlaceholder = !Array.isArray(points) || points.length < 2
  const safePoints = isPlaceholder ? PLACEHOLDER_POINTS : points

  const { left: padL, right: padR, top: padT, bottom: padB } = CHART_PADDING
  const chartW = Math.max(40, width - padL - padR)
  const chartH = Math.max(40, height - padT - padB)

  const toY = (pct: number) => padT + ((100 - clampPct(pct)) / 90) * chartH
  const toX = (idx: number) =>
    padL + (safePoints.length === 1 ? chartW / 2 : (idx / (safePoints.length - 1)) * chartW)

  const layout = safePoints.map((point, i) => ({
    x: toX(i),
    y: toY(point.retention_pct),
    baselineY: toY(typeof point.baseline_pct === 'number' ? point.baseline_pct : point.retention_pct),
    point,
  }))

  const recoveryIdx = safePoints.findIndex((p) => p.is_recovery)
  const todayIdx = safePoints.findIndex((p) => p.is_today)
  const activeStart = todayIdx >= 0 ? todayIdx : recoveryIdx > 0 ? recoveryIdx - 1 : 0

  const recoveryLabel =
    recoveryIdx >= 0
      ? buildRecoveryLabel(safePoints[recoveryIdx], todayIdx >= 0 ? safePoints[todayIdx] : null)
      : null

  const lastIdx = safePoints.length - 1
  const lastLabel = safePoints[lastIdx].day_label
  const midIdx = recoveryIdx >= 0 ? recoveryIdx : Math.floor(safePoints.length / 2)
  const axisLabels = [
    { text: safePoints[0].day_label, x: padL },
    { text: safePoints[midIdx].day_label, x: Math.max(padL + 42, toX(midIdx) - 18) },
    { text: lastLabel, x: Math.max(padL + 96, width - padR - lastLabel.length * 9) },
  ]

  return {
    isPlaceholder,
    points: safePoints,
    layout,
    chartW,
    chartH,
    y100: toY(100),
    y50: toY(50),
    hasBaseline: safePoints.some((p) => typeof p.baseline_pct === 'number'),
    todayIdx,
    recoveryIdx,
    activeStart,
    recoveryLabel,
    axisLabels,
  }
}
