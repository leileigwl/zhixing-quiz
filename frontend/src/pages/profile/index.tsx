import { useState, useCallback } from 'react'
import { View, Text, Image, Button, Input } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import {
  getUserProfile,
  getQuizHistory,
  updateUserProfile,
  setCachedUser,
  waitForLogin,
} from '../../services/api'
import type { UserProfile, QuizHistoryItem } from '../../services/api'
import './index.scss'

export default function ProfilePage() {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [historyItems, setHistoryItems] = useState<QuizHistoryItem[]>([])
  const [totalHistory, setTotalHistory] = useState(0)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState('')

  const loadProfile = useCallback(async () => {
    await waitForLogin()
    try {
      const data = await getUserProfile()
      setProfile(data)
      setCachedUser({
        id: data.id,
        nickname: data.nickname,
        avatar_url: data.avatar_url,
        total_xp: data.total_xp,
      })
    } catch {
      // keep silent when backend offline
    }
  }, [])

  const loadHistory = useCallback(async (p: number, reset = false) => {
    await waitForLogin()
    setLoadingMore(true)
    try {
      const data = await getQuizHistory(p, 10)
      setHistoryItems((prev) => (reset ? data.items : [...prev, ...data.items]))
      setTotalHistory(data.total)
      setPage(p)
      setHasMore(data.items.length >= 10 && p * 10 < data.total)
    } catch {
      // ignore offline
    } finally {
      setLoadingMore(false)
    }
  }, [])

  useDidShow(() => {
    void loadProfile()
    void loadHistory(1, true)
  })

  const handleLoadMore = () => {
    if (!hasMore || loadingMore) return
    void loadHistory(page + 1, false)
  }

  const handleViewDetail = (quizId: string) => {
    Taro.navigateTo({
      url: `/pages/report/index?quizId=${encodeURIComponent(quizId)}`,
    })
  }

  const handleChooseAvatar = (e: any) => {
    const avatarUrl = e?.detail?.avatarUrl
    if (avatarUrl) {
      updateUserProfile({ avatar_url: avatarUrl })
        .then(() => loadProfile())
        .catch(() => {})
    }
  }

  const handleOpenEdit = () => {
    setDraftName(profile?.nickname || '学习者')
    setEditing(true)
  }

  const handleSaveNickname = (e?: any) => {
    e?.stopPropagation?.()
    const trimmed = draftName.trim()
    setEditing(false)
    if (!trimmed || trimmed === profile?.nickname) return
    updateUserProfile({ nickname: trimmed })
      .then(() => {
        Taro.showToast({ title: '昵称已更新', icon: 'success' })
        return loadProfile()
      })
      .catch((err) => {
        Taro.showToast({ title: err?.message || '更新失败', icon: 'none' })
      })
  }

  const avatarInitial = profile?.nickname?.[0] || '高'

  return (
    <View className='profile-page'>
      {/* 个人资料卡 */}
      <View className='zx-card profile-hero'>
        {process.env.TARO_ENV === 'weapp' ? (
          <Button className='avatar-btn' openType='chooseAvatar' onChooseAvatar={handleChooseAvatar}>
            {profile?.avatar_url ? (
              <Image className='avatar-lg-img' src={profile.avatar_url} mode='aspectFill' />
            ) : (
              <View className='avatar-lg-fallback'>
                <Text>{avatarInitial}</Text>
              </View>
            )}
          </Button>
        ) : profile?.avatar_url ? (
          <Image className='avatar-lg-img' src={profile.avatar_url} mode='aspectFill' />
        ) : (
          <View className='avatar-lg-fallback'>
            <Text>{avatarInitial}</Text>
          </View>
        )}

        <View className='profile-info'>
          {editing ? (
            <View key='edit-name' className='edit-name-row'>
              <Input
                type={process.env.TARO_ENV === 'weapp' ? 'nickname' : 'text'}
                className='nickname-input'
                value={draftName}
                focus
                maxlength={32}
                onInput={(e) => setDraftName(e.detail.value)}
                onConfirm={handleSaveNickname}
              />
              <View className='btn-save-name' onClick={handleSaveNickname}>
                <Text>保存</Text>
              </View>
            </View>
          ) : (
            <View key='view-name' className='profile-name-row' onClick={handleOpenEdit}>
              <Text className='profile-name'>{profile?.nickname || '学习者'}</Text>
              <Text className='edit-icon'>✎</Text>
            </View>
          )}
          <Text className='profile-motto'>知行快刷，刷出真知！</Text>
        </View>
      </View>

      {/* 2x2 数据看板 */}
      <View className='kpi-grid'>
        <View className='zx-card kpi-card'>
          <Text className='kpi-num is-primary'>
            {profile?.total_xp ?? 0}
            <Text className='kpi-unit'> XP</Text>
          </Text>
          <Text className='kpi-label'>累计经验值</Text>
        </View>
        <View className='zx-card kpi-card'>
          <Text className='kpi-num'>
            {profile?.quiz_count ?? 0}
            <Text className='kpi-unit'> 次</Text>
          </Text>
          <Text className='kpi-label'>闯关次数</Text>
        </View>
        <View className='zx-card kpi-card'>
          <Text className='kpi-num'>
            {profile?.correct_count ?? 0}
            <Text className='kpi-unit'> 题</Text>
          </Text>
          <Text className='kpi-label'>累计答对</Text>
        </View>
        <View className='zx-card kpi-card'>
          <Text className='kpi-num is-primary'>{profile?.average_accuracy ?? 0}%</Text>
          <Text className='kpi-label'>平均正确率</Text>
        </View>
      </View>

      {/* 历史闯关记录 */}
      <View className='section-head'>
        <Text className='section-title'>历史闯关记录</Text>
        <Text className='section-count'>共 {totalHistory} 条</Text>
      </View>

      {historyItems.length === 0 ? (
        <View className='zx-card empty-history'>
          <Text className='empty-text'>暂无闯关记录，去首页开始第一轮自测吧</Text>
        </View>
      ) : (
        <View className='history-list'>
          {historyItems.map((item) => {
            const acc = Math.round(item.accuracy)
            const accCls = acc >= 90 ? 'is-mid' : acc >= 75 ? 'is-high' : 'is-warn'
            return (
              <View
                key={item.quiz_id}
                className='zx-card history-card'
                onClick={() => handleViewDetail(item.quiz_id)}
              >
                <View className='history-left'>
                  <Text className='history-title'>{item.title}</Text>
                  <Text className='history-time'>{item.created_at}</Text>
                  <Text className='history-meta'>共 {item.question_count} 题</Text>
                </View>
                <View className={`acc-tag ${accCls}`}>
                  <Text>{acc}%</Text>
                </View>
              </View>
            )
          })}
          {hasMore && (
            <View className='load-more' onClick={handleLoadMore}>
              <Text className='load-more-text'>{loadingMore ? '加载中...' : '加载更多'}</Text>
            </View>
          )}
        </View>
      )}
    </View>
  )
}
