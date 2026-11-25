import { View, Text } from '@tarojs/components'
import LineIcon, { type IconName } from '../LineIcon'
import './index.scss'

interface EmptyStateProps {
  icon?: IconName
  title: string
  desc?: string
  actionText?: string
  onAction?: () => void
  className?: string
}

/** 无真实数据时的空状态：说明 + 一个直接去做的按钮（不展示任何示例数据） */
export default function EmptyState({ icon = 'sparkle', title, desc, actionText, onAction, className = '' }: EmptyStateProps) {
  return (
    <View className={`zx-empty ${className}`}>
      <View className='zx-empty-icon'>
        <LineIcon name={icon} size={22} color='#6e7280' />
      </View>
      <Text className='zx-empty-title'>{title}</Text>
      {desc ? <Text className='zx-empty-desc'>{desc}</Text> : null}
      {actionText && onAction ? (
        <View className='zx-empty-action zx-press' onClick={onAction}>
          <Text>{actionText}</Text>
        </View>
      ) : null}
    </View>
  )
}
