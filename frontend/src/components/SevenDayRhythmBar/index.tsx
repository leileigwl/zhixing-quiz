import { View, Text } from '@tarojs/components'
import type { WeeklyRhythmDay } from '../../services/api'
import './index.scss'

interface SevenDayRhythmBarProps {
  days: WeeklyRhythmDay[]
  selectedIndex?: number | null
  onSelectDay?: (day: WeeklyRhythmDay, idx: number) => void
}

/** 方案 B（MOVEPOP）本周 7 日真实题量动态归一化节律柱图（无锯齿外框，含周均虚线参考与干净选中态） */
export default function SevenDayRhythmBar({
  days,
  selectedIndex,
  onSelectDay,
}: SevenDayRhythmBarProps) {
  const safeDays = days.slice(0, 7)
  const counts = safeDays.map((d) => d.completed_count || 0)
  const maxVal = Math.max(1, ...counts)
  const totalVal = counts.reduce((s, v) => s + v, 0)
  const activeDays = counts.filter((c) => c > 0).length
  const avgVal = activeDays > 0 ? totalVal / activeDays : 0
  const avgLineBottomPct = avgVal > 0 ? Math.max(14, Math.min(92, Math.round((avgVal / maxVal) * 100))) : 0

  return (
    <View className='zx-bars-7-wrap'>
      {avgLineBottomPct > 0 && (
        <View
          className='zx-bar-avg-line'
          style={{ bottom: `calc(44px + ${Math.round((avgLineBottomPct / 100) * 116)}px)` }}
        />
      )}
      <View className='zx-bars-7'>
        {safeDays.map((day, idx) => {
          const cnt = day.completed_count || 0
          const pct =
            cnt <= 0
              ? 8
              : cnt === maxVal
                ? 100
                : Math.max(22, Math.min(96, Math.round((cnt / maxVal) * 100)))
          const isSelected = selectedIndex === idx
          return (
            <View
              key={`${day.date_num}-${idx}`}
              className={`zx-bar-col ${onSelectDay ? 'is-clickable' : ''}`}
              onClick={() => onSelectDay?.(day, idx)}
            >
              <Text className={`zx-bar-cnt ${cnt > 0 ? 'has-val' : ''}`}>
                {cnt > 0 ? cnt : ''}
              </Text>
              <View className='zx-bar-track'>
                <View
                  className={`zx-bar-fill ${day.is_today ? 'is-today' : cnt > 0 ? 'is-active' : ''}`}
                  style={{ height: `${pct}%` }}
                />
              </View>
              <View className={`zx-bar-lbl-pill ${isSelected ? 'is-selected' : ''}`}>
                <Text className={`zx-bar-lbl ${day.is_today ? 'is-today' : ''} ${isSelected ? 'is-selected' : ''}`}>
                  {day.is_today ? '今' : day.day_label}
                </Text>
              </View>
            </View>
          )
        })}
      </View>
    </View>
  )
}
