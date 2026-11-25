import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import type { WeeklyRhythmDay } from '../../services/api'
import SevenDayRhythmBar from './index'
import { BAR_LABEL_OFFSET_PX, BAR_TRACK_PX, buildRhythmModel, computeBarHeightPct } from './rhythmModel'

const LABELS = ['四', '五', '六', '日', '一', '二', '三']
const week = (counts: number[], todayIdx = 4): WeeklyRhythmDay[] =>
  counts.map((c, i) => ({
    day_label: LABELS[i],
    date_num: String(20 + i),
    completed_count: c,
    is_today: i === todayIdx,
    active: c > 0 || i === todayIdx,
  }))

describe('computeBarHeightPct', () => {
  it('0 题 8% 占位，最大值 100%，其余按比例夹在 [22, 96]', () => {
    expect(computeBarHeightPct(0, 10)).toBe(8)
    expect(computeBarHeightPct(10, 10)).toBe(100)
    expect(computeBarHeightPct(1, 10)).toBe(22)
    expect(computeBarHeightPct(5, 10)).toBe(50)
    expect(computeBarHeightPct(99, 100)).toBe(96)
  })
})

describe('buildRhythmModel', () => {
  it('统计总量、活跃天数与周均线（只按活跃日平均）', () => {
    const m = buildRhythmModel(week([0, 4, 0, 8, 6, 0, 0]))
    expect(m.totalVal).toBe(18)
    expect(m.activeDays).toBe(3)
    expect(m.avgVal).toBe(6)
    expect(m.maxVal).toBe(8)
    expect(m.avgLineBottomPct).toBe(75)
    expect(m.avgLineBottomCss).toBe(`calc(${BAR_LABEL_OFFSET_PX}px + ${Math.round(0.75 * BAR_TRACK_PX)}px)`)
  })

  it('整周无练习：不画周均线，所有柱为 8% 占位', () => {
    const m = buildRhythmModel(week([0, 0, 0, 0, 0, 0, 0]))
    expect(m.avgLineBottomCss).toBeNull()
    expect(m.bars.every((b) => b.heightPct === 8)).toBe(true)
  })

  it('周均线夹在 [14, 92]', () => {
    expect(buildRhythmModel(week([100, 1, 1, 1, 1, 1, 1])).avgLineBottomPct).toBe(15)
    expect(buildRhythmModel(week([10, 10, 10, 10, 10, 10, 10])).avgLineBottomPct).toBe(92)
  })

  it('今日标签为「今」，状态类今日优先于活跃', () => {
    const m = buildRhythmModel(week([1, 0, 0, 0, 3, 0, 0]))
    expect(m.bars[4]).toMatchObject({ label: '今', fillState: 'is-today' })
    expect(m.bars[0].fillState).toBe('is-active')
    expect(m.bars[1].fillState).toBe('')
  })

  it('超过 7 天只取前 7 天；空输入安全', () => {
    expect(buildRhythmModel([...week([1, 1, 1, 1, 1, 1, 1]), ...week([9])]).bars).toHaveLength(7)
    expect(buildRhythmModel([]).bars).toHaveLength(0)
  })
})

describe('<SevenDayRhythmBar />', () => {
  it('渲染 7 根柱子、题量与选中态，点击回调带上日期与下标', () => {
    const onSelect = vi.fn()
    const days = week([0, 4, 0, 8, 6, 0, 0])
    const { container } = render(<SevenDayRhythmBar days={days} selectedIndex={3} onSelectDay={onSelect} />)

    const cols = container.querySelectorAll('.zx-bar-col')
    expect(cols).toHaveLength(7)
    expect(cols[0].className).toContain('is-clickable')
    const fills = Array.from(container.querySelectorAll<HTMLElement>('.zx-bar-fill')).map((el) => el.style.height)
    expect(fills).toEqual(['8%', '50%', '8%', '100%', '75%', '8%', '8%'])
    expect(container.querySelectorAll('.zx-bar-lbl-pill.is-selected')).toHaveLength(1)
    expect(container.querySelector('.zx-bar-avg-line')).not.toBeNull()

    fireEvent.click(cols[3])
    expect(onSelect).toHaveBeenCalledWith(days[3], 3)
  })

  it('不传 onSelectDay 时不显示可点击态', () => {
    const { container } = render(<SevenDayRhythmBar days={week([0, 0, 0, 0, 0, 0, 0])} />)
    expect(container.querySelector('.is-clickable')).toBeNull()
    expect(container.querySelector('.zx-bar-avg-line')).toBeNull()
  })
})
