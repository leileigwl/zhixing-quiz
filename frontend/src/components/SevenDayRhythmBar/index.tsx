import { View, Text } from '@tarojs/components'
import type { WeeklyRhythmDay } from '../../services/api'
import './index.scss'

interface SevenDayRhythmBarProps {
  days: WeeklyRhythmDay[]
  selectedIndex?: number | null
  onSelectDay?: (day: WeeklyRhythmDay, idx: number) => void
}

/** 方案 B（MOVEPOP）本周 7 日真实题量动态归一化节律柱图（支持点击下钻当日明细） */
export default function SevenDayRhythmBar({
  days,
  selectedIndex,
  onSelectDay,
}: SevenDayRhythmBarProps) {
  const safeDays = days.slice(0, 7)
  const maxVal = Math.max(1, ...safeDays.map((d) => d.completed_count || 0))

  return (
    <View className='zx-bars-7'>
      {safeDays.map((day, idx) => {
        const cnt = day.completed_count || 0
        const pct =
          cnt <= 0
            ? 10
            : Math.max(24, Math.min(96, Math.round((cnt / maxVal) * 96)))
        const isSelected = selectedIndex === idx
        return (
          <View
            key={`${day.date_num}-${idx}`}
            className={`zx-bar-col ${onSelectDay ? 'is-clickable' : ''} ${isSelected ? 'is-selected' : ''}`}
            onClick={() => onSelectDay?.(day, idx)}
          >
            <Text className={`zx-bar-cnt ${cnt > 0 ? 'has-val' : ''}`}>
              {cnt > 0 ? cnt : ''}
            </Text>
            <View className={`zx-bar-track ${isSelected ? 'is-selected' : ''}`}>
              <View
                className={`zx-bar-fill ${day.is_today ? 'is-today' : cnt > 0 ? 'is-active' : ''}`}
                style={{ height: `${pct}%` }}
              />
            </View>
            <Text className={`zx-bar-lbl ${day.is_today ? 'is-today' : ''} ${isSelected ? 'is-selected' : ''}`}>
              {day.is_today ? '今' : day.day_label}
            </Text>
          </View>
        )
      })}
    </View>
  )
}
