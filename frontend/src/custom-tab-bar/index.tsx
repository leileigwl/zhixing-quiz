import { useState, useEffect } from 'react'
import Taro from '@tarojs/taro'
import FloatingDock, { type DockTabKey } from '../components/FloatingDock'

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

  return (
    <FloatingDock
      activeKey={activeKey}
      onSwitch={(key, url) => {
        setActiveKey(key)
        Taro.switchTab({ url })
      }}
    />
  )
}
