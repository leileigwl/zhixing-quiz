import { View, Text } from '@tarojs/components'
import type { WeeklyRhythmDay } from '../../services/api'
import { buildRhythmModel } from './rhythmModel'
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
  const model = buildRhythmModel(days)

  return (
    <View className='zx-bars-7-wrap'>
      {model.avgLineBottomCss && (
        <View className='zx-bar-avg-line' style={{ bottom: model.avgLineBottomCss }} />
      )}
      <View className='zx-bars-7'>
        {model.bars.map(({ day, count: cnt, heightPct, fillState, label }, idx) => {
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
                <View className={`zx-bar-fill ${fillState}`} style={{ height: `${heightPct}%` }} />
              </View>
              <View className={`zx-bar-lbl-pill ${isSelected ? 'is-selected' : ''}`}>
                <Text className={`zx-bar-lbl ${day.is_today ? 'is-today' : ''} ${isSelected ? 'is-selected' : ''}`}>
                  {label}
                </Text>
              </View>
            </View>
          )
        })}
      </View>
    </View>
  )
}
