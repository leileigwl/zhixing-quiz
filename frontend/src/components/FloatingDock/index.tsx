import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import './index.scss'

export type DockTabKey = 'index' | 'knowledge' | 'mastery' | 'profile'

interface FloatingDockProps {
  activeKey: DockTabKey
  onSwitch?: (key: DockTabKey, path: string) => void
}

const TABS: Array<{ key: DockTabKey; label: string; url: string }> = [
  { key: 'index', label: '今日', url: '/pages/index/index' },
  { key: 'knowledge', label: '口袋', url: '/pages/knowledge/index' },
  { key: 'mastery', label: '曲线', url: '/pages/mastery/index' },
  { key: 'profile', label: '我的', url: '/pages/profile/index' },
]

function DockGlyph({ kind, active }: { kind: DockTabKey; active: boolean }) {
  const toneClass = active ? 'is-dark' : 'is-light'

  if (kind === 'index') {
    return (
      <View className={`dock-glyph glyph-home ${toneClass}`}>
        <View className='gh-roof' />
        <View className='gh-body'>
          <View className='gh-door' />
        </View>
      </View>
    )
  }
  if (kind === 'knowledge') {
    return (
      <View className={`dock-glyph glyph-pocket ${toneClass}`}>
        <View className='gp-flap' />
        <View className='gp-box' />
      </View>
    )
  }
  if (kind === 'mastery') {
    return (
      <View className={`dock-glyph glyph-bars ${toneClass}`}>
        <View className='gb-bar b1' />
        <View className='gb-bar b2' />
        <View className='gb-bar b3' />
      </View>
    )
  }
  return (
    <View className={`dock-glyph glyph-user ${toneClass}`}>
      <View className='gu-head' />
      <View className='gu-shoulder' />
    </View>
  )
}

export default function FloatingDock({ activeKey, onSwitch }: FloatingDockProps) {
  const handleTap = (item: (typeof TABS)[number]) => {
    if (onSwitch) {
      onSwitch(item.key, item.url)
      return
    }
    if (item.key === activeKey) return
    Taro.switchTab({ url: item.url })
  }

  return (
    <View className='zx-dock-wrap'>
      <View className='zx-dock-pill'>
        {TABS.map((item) => {
          const isActive = item.key === activeKey
          return (
            <View
              key={item.key}
              className={`zx-dock-tab zx-press ${isActive ? 'is-active' : ''}`}
              onClick={() => handleTap(item)}
              aria-label={item.label}
            >
              <DockGlyph kind={item.key} active={isActive} />
              <Text className='zx-dock-sr'>{item.label}</Text>
            </View>
          )
        })}
      </View>
    </View>
  )
}
