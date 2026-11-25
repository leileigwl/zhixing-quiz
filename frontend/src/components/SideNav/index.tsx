import { useEffect, useState } from 'react'
import { View, Text, Image } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { DOCK_TABS, DockGlyph, type DockTabKey } from '../FloatingDock'
import { getCachedUser, getLoginEmail } from '../../services/api'
import { formatNavDueCount, getNavDueCount, subscribeNavDueCount } from './navBadge'
import './index.scss'

/** 宽屏（≥1100）点「+ 发起新测验」时，首页收到此事件后聚焦输入舱 */
export const FOCUS_COMPOSER_EVENT = 'zx:focus-composer'

interface SideNavProps {
  activeKey: DockTabKey
}

export function goToNavTab(key: DockTabKey, activeKey: DockTabKey) {
  if (key === activeKey) return
  const tab = DOCK_TABS.find((t) => t.key === key)
  if (tab) Taro.switchTab({ url: tab.url })
}

export function startNewQuiz(activeKey: DockTabKey) {
  if (activeKey !== 'index') {
    Taro.switchTab({ url: '/pages/index/index' })
  }
  // 等首页显示后再聚焦（switchTab 在 H5 是异步切换）
  setTimeout(() => Taro.eventCenter.trigger(FOCUS_COMPOSER_EVENT), activeKey === 'index' ? 0 : 120)
}

/** V2.9 宽屏左侧侧栏（仅 H5 ≥1100 由 ResponsiveNav 渲染）：品牌、4 项导航、待巩固计数、发起新测验、当前用户 */
export default function SideNav({ activeKey }: SideNavProps) {
  const [dueCount, setDueCount] = useState<number | null>(() => getNavDueCount())
  const user = getCachedUser()
  const email = getLoginEmail()

  useEffect(() => subscribeNavDueCount(setDueCount), [])

  const badge = formatNavDueCount(dueCount)
  const nickname = user?.nickname || '同学'

  return (
    <View className='zx-sidenav' aria-label='主导航'>
      <View className='zx-sn-brand'>
        <View className='zx-brand-mark'>
          <View className='bm-a' />
          <View className='bm-b' />
          <View className='bm-c' />
        </View>
        <Text className='zx-sn-brand-name'>知行快刷</Text>
      </View>

      {DOCK_TABS.map((tab) => {
        const isActive = tab.key === activeKey
        return (
          <View
            key={tab.key}
            className={`zx-sn-item ${isActive ? 'is-active' : ''}`}
            onClick={() => goToNavTab(tab.key, activeKey)}
            aria-label={tab.label}
            aria-current={isActive ? 'page' : undefined}
          >
            <DockGlyph kind={tab.key} active={false} />
            <Text className='zx-sn-label'>{tab.label}</Text>
            {tab.key === 'index' && badge ? (
              <Text className='zx-sn-count' aria-label={`${badge} 题待巩固`}>
                {badge}
              </Text>
            ) : null}
          </View>
        )
      })}

      <View className='zx-sn-cta' onClick={() => startNewQuiz(activeKey)}>
        <Text>+ 发起新测验</Text>
      </View>

      <View className='zx-sn-foot'>
        <View className='zx-sn-user' onClick={() => goToNavTab('profile', activeKey)} aria-label='我的账号'>
          {user?.avatar_url ? (
            <Image className='zx-sn-avatar' src={user.avatar_url} mode='aspectFill' />
          ) : (
            <View className='zx-sn-avatar is-mono'>
              <Text>{nickname[0]}</Text>
            </View>
          )}
          <View className='zx-sn-user-texts'>
            <Text className='zx-sn-user-name'>{nickname}</Text>
            {email ? <Text className='zx-sn-user-sub'>{email}</Text> : null}
          </View>
        </View>
      </View>
    </View>
  )
}
