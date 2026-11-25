import { describe, expect, it } from 'vitest'
import type { RetentionCurvePoint } from '../../services/api'
import { CHART_PADDING, PLACEHOLDER_POINTS, buildRecoveryLabel, clampPct, prepareRetentionChart } from './chartModel'

const W = 300
const H = 126
const chartH = H - CHART_PADDING.top - CHART_PADDING.bottom

const curve: RetentionCurvePoint[] = [
  { day_label: '11/18', retention_pct: 60, baseline_pct: 60, is_actual: true },
  { day_label: '11/22', retention_pct: 85, baseline_pct: 85, is_actual: true },
  { day_label: '今日保持', retention_pct: 52, baseline_pct: 52, is_today: true },
  { day_label: '若巩固', retention_pct: 80, baseline_pct: 40, is_recovery: true },
  { day_label: '+3天', retention_pct: 70, baseline_pct: 30 },
  { day_label: '+14天', retention_pct: 45, baseline_pct: 15 },
]

describe('prepareRetentionChart', () => {
  it('少于 2 个点时使用占位形状并显式标记 isPlaceholder', () => {
    for (const pts of [[], [curve[0]]]) {
      const m = prepareRetentionChart(pts, W, H)
      expect(m.isPlaceholder).toBe(true)
      expect(m.points).toBe(PLACEHOLDER_POINTS)
    }
    expect(prepareRetentionChart(curve, W, H).isPlaceholder).toBe(false)
  })

  it('X 均匀分布在左右留白之间，Y 把 100%→顶部、10%→底部', () => {
    const m = prepareRetentionChart(curve, W, H)
    expect(m.layout[0].x).toBe(CHART_PADDING.left)
    expect(m.layout[m.layout.length - 1].x).toBe(W - CHART_PADDING.right)
    expect(m.y100).toBe(CHART_PADDING.top)
    expect(m.y50).toBeCloseTo(CHART_PADDING.top + (50 / 90) * chartH, 5)
    const yOf = (pct: number) => prepareRetentionChart([{ day_label: 'a', retention_pct: pct }, curve[1]], W, H).layout[0].y
    expect(yOf(5)).toBe(yOf(10)) // 下限夹到 10%
    expect(yOf(120)).toBe(yOf(100)) // 上限夹到 100%
  })

  it('无 baseline 时虚线对照沿用实际保持率', () => {
    const m = prepareRetentionChart([{ day_label: 'a', retention_pct: 70 }, { day_label: 'b', retention_pct: 50 }], W, H)
    expect(m.hasBaseline).toBe(false)
    expect(m.layout[0].baselineY).toBe(m.layout[0].y)
  })

  it('今日 / 恢复点索引、面积起点与恢复点增益文案', () => {
    const m = prepareRetentionChart(curve, W, H)
    expect(m.todayIdx).toBe(2)
    expect(m.recoveryIdx).toBe(3)
    expect(m.activeStart).toBe(2)
    expect(m.recoveryLabel).toBe('巩固 80% (+28%)')
  })

  it('没有今日点时面积从恢复点前一个开始；恢复点无增益时显示「保持」', () => {
    const pts = curve.filter((p) => !p.is_today)
    const m = prepareRetentionChart(pts, W, H)
    expect(m.todayIdx).toBe(-1)
    expect(m.activeStart).toBe(m.recoveryIdx - 1)
    expect(m.recoveryLabel).toBe('保持 80%')
    expect(buildRecoveryLabel({ day_label: 'x', retention_pct: 50 }, { day_label: 'y', retention_pct: 60 })).toBe('保持 50%')
  })

  it('X 轴标签：首 / 恢复点 / 末，且不会互相挤出画布', () => {
    const m = prepareRetentionChart(curve, W, H)
    expect(m.axisLabels.map((l) => l.text)).toEqual(['11/18', '若巩固', '+14天'])
    expect(m.axisLabels[0].x).toBe(CHART_PADDING.left)
    expect(m.axisLabels[1].x).toBeGreaterThanOrEqual(CHART_PADDING.left + 42)
    expect(m.axisLabels[2].x).toBeGreaterThanOrEqual(CHART_PADDING.left + 96)
  })

  it('不同数据得到不同几何（回归：曲线每天一样）', () => {
    const a = prepareRetentionChart(curve, W, H).layout.map((p) => p.y)
    const shifted = curve.map((p) => (p.is_today ? { ...p, retention_pct: 40 } : p))
    const b = prepareRetentionChart(shifted, W, H).layout.map((p) => p.y)
    expect(a).not.toEqual(b)
  })

  it('clampPct', () => {
    expect(clampPct(-5)).toBe(10)
    expect(clampPct(55)).toBe(55)
    expect(clampPct(140)).toBe(100)
  })
})
