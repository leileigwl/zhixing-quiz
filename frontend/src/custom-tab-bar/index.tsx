import { useState, useEffect } from 'react'
import { View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import type { DockTabKey } from '../components/FloatingDock'
import './index.scss'

const TABS: Array<{ key: DockTabKey; url: string }> = [
  { key: 'index', url: '/pages/index/index' },
  { key: 'knowledge', url: '/pages/knowledge/index' },
  { key: 'mastery', url: '/pages/mastery/index' },
  { key: 'profile', url: '/pages/profile/index' },
]

const ROUTE_TO_KEY: Record<string, DockTabKey> = {
  'pages/index/index': 'index',
  '/pages/index/index': 'index',
  'pages/knowledge/index': 'knowledge',
  '/pages/knowledge/index': 'knowledge',
  'pages/mastery/index': 'mastery',
  '/pages/mastery/index': 'mastery',
  'pages/profile/index': 'profile',
  '/pages/profile/index': 'profile',
}

function WeappDockGlyph({ kind }: { kind: DockTabKey }) {
  if (kind === 'index') {
    return (
      <View className='wx-dock-glyph wx-glyph-home'>
        <View className='wx-gh-roof' />
        <View className='wx-gh-body'>
          <View className='wx-gh-door' />
        </View>
      </View>
    )
  }
  if (kind === 'knowledge') {
    return (
      <View className='wx-dock-glyph wx-glyph-pocket'>
        <View className='wx-gp-flap' />
        <View className='wx-gp-box' />
      </View>
    )
  }
  if (kind === 'mastery') {
    return (
      <View className='wx-dock-glyph wx-glyph-bars'>
        <View className='wx-gb-bar b1' />
        <View className='wx-gb-bar b2' />
        <View className='wx-gb-bar b3' />
      </View>
    )
  }
  return (
    <View className='wx-dock-glyph wx-glyph-user'>
      <View className='wx-gu-head' />
      <View className='wx-gu-shoulder' />
    </View>
  )
}

export default function CustomTabBar() {
  const [activeKey, setActiveKey] = useState<DockTabKey>('index')

  useEffect(() => {
    const syncRoute = () => {
      const pages = Taro.getCurrentPages()
      const current = pages[pages.length - 1]
      const key = current?.route ? ROUTE_TO_KEY[current.route] : undefined
      if (key) {
        setActiveKey(key)
      }
    }

    syncRoute()
    const handler = (key: DockTabKey) => setActiveKey(key)
    Taro.eventCenter.on('zx:tab-change', handler)
    return () => {
      Taro.eventCenter.off('zx:tab-change', handler)
    }
  }, [])

  const handleSwitch = (tab: (typeof TABS)[number]) => {
    setActiveKey(tab.key)
    Taro.switchTab({ url: tab.url })
  }

  return (
    <View className='wx-dock-wrap'>
      <View className='wx-dock-pill'>
        {TABS.map((tab) => (
          <View
            key={tab.key}
            className={`wx-dock-tab ${activeKey === tab.key ? 'is-active' : ''}`}
            hoverClass='wx-dock-tab-hover'
            hoverStayTime={60}
            onClick={() => handleSwitch(tab)}
          >
            <WeappDockGlyph kind={tab.key} />
          </View>
        ))}
      </View>
    </View>
  )
}
