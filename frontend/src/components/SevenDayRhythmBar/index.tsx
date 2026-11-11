import { View, Text } from '@tarojs/components'
import type { WeeklyRhythmDay } from '../../services/api'
import './index.scss'

interface SevenDayRhythmBarProps {
  days: WeeklyRhythmDay[]
}

/** 方案 B（MOVEPOP）本周 7 日纤细圆角节律竖柱 */
export default function SevenDayRhythmBar({ days }: SevenDayRhythmBarProps) {
  const safeDays = days.slice(0, 7)
  const maxVal = Math.max(100, ...safeDays.map((d) => d.completed_count || 0))

  return (
    <View className='zx-bars-7'>
      {safeDays.map((day, idx) => {
        const pct = Math.max(22, Math.min(96, Math.round(((day.completed_count || 20) / maxVal) * 100)))
        return (
          <View key={`${day.date_num}-${idx}`} className='zx-bar-col'>
            <View className='zx-bar-track'>
              <View
                className={`zx-bar-fill ${day.is_today ? 'is-today' : ''}`}
                style={{ height: `${pct}%` }}
              />
            </View>
            <Text className={`zx-bar-lbl ${day.is_today ? 'is-today' : ''}`}>
              {day.is_today ? '今' : day.day_label}
            </Text>
          </View>
        )
      })}
    </View>
  )
}
