import { View, Text } from '@tarojs/components'
import { normalizePercent, ringBackground } from './ringModel'
import './index.scss'

export type RingTone = 'brand' | 'coral' | 'mint' | 'sky'

const TONES: Record<RingTone, [string, string]> = {
  brand: ['#5b4cf0', '#db2777'],
  coral: ['#ffb020', '#ff6b4a'],
  mint: ['#3b9cf0', '#1fbf8f'],
  sky: ['#7c3aed', '#3b9cf0'],
}

interface ProgressRingProps {
  /** 0–100；null / undefined 表示还没有数据，中心显示「—」 */
  value: number | null | undefined
  tone?: RingTone
  /** 中心下方的小字 */
  caption?: string
  className?: string
}

/** V3.0 进度环（CSS conic-gradient，H5 与小程序通用；尺寸由外层 className 控制） */
export default function ProgressRing({ value, tone = 'brand', caption, className = '' }: ProgressRingProps) {
  const p = normalizePercent(value)
  const [from, to] = TONES[tone]
  return (
    <View
      className={`zx-ring ${p === null ? 'is-empty' : ''} ${className}`}
      style={{ background: ringBackground(p, from, to, 'rgba(91, 76, 240, 0.10)') }}
      aria-label={p === null ? '暂无数据' : `${p}%`}
    >
      <View className='zx-ring-hole'>
        <Text className='zx-ring-num'>{p === null ? '—' : `${p}%`}</Text>
        {caption ? <Text className='zx-ring-cap'>{caption}</Text> : null}
      </View>
    </View>
  )
}
