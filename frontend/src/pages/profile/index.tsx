import { useState, useCallback, useMemo } from 'react'
import { View, Text, Image, Button, Input } from '@tarojs/components'
import Taro, { useDidHide, useDidShow } from '@tarojs/taro'
import {
  getUserProfile,
  getQuizHistory,
  getDueReviews,
  generateQuizAsync,
  pollQuizTask,
  updateUserProfile,
  setCachedUser,
  waitForLogin,
  type UserProfile,
  type QuizHistoryItem,
  type DueReviewsResponse,
} from '../../services/api'
import { setActiveQuizSession } from '../../services/quizSessionStore'
import { buildEmptyDueReviews, buildRealCalendarStrip } from '../../services/v2Adapters'
import FloatingDock from '../../components/FloatingDock'
import './index.scss'

export default function ProfilePage() {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [historyItems, setHistoryItems] = useState<QuizHistoryItem[]>([])
  const [dueReviews, setDueReviews] = useState<DueReviewsResponse>(buildEmptyDueReviews())
  const [totalHistory, setTotalHistory] = useState(0)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [startingDueQuiz, setStartingDueQuiz] = useState(false)
  const [dockVisible, setDockVisible] = useState(true)

  const loadProfile = useCallback(async () => {
    await waitForLogin()
    const [data, dueRes] = await Promise.all([
      getUserProfile().catch(() => null),
      getDueReviews(10),
    ])
    if (data) {
      setProfile(data)
      setCachedUser({
        id: data.id,
        nickname: data.nickname,
        avatar_url: data.avatar_url,
        total_xp: data.total_xp,
        streak_days: data.streak_days,
      })
    }
    if (dueRes) setDueReviews(dueRes)
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
    setDockVisible(true)
    Taro.eventCenter.trigger('zx:tab-change', 'profile')
    void loadProfile()
    void loadHistory(1, true)
  })

  useDidHide(() => {
    setDockVisible(false)
  })

  const stampWeek = useMemo(() => buildRealCalendarStrip(), [])

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

  const handleStartDueQueue = async () => {
    if (startingDueQuiz || dueReviews.items.length === 0) return
    setStartingDueQuiz(true)
    try {
      const ids = dueReviews.items.slice(0, 6).map((c) => c.card_id)
      const { task_id } = await generateQuizAsync({
        user_input: '针对待复习错题清单生成专题回顾测验',
        question_count: ids.length,
        adaptive_mode: true,
        review_card_ids: ids,
      })
      const quizData = await pollQuizTask(task_id)
      setActiveQuizSession(quizData, [])
      Taro.navigateTo({
        url: `/pages/quiz/index?quizId=${encodeURIComponent(quizData.quiz_id)}`,
      })
    } catch (err: any) {
      Taro.showToast({ title: err?.message || '调起复习失败', icon: 'none' })
    } finally {
      setStartingDueQuiz(false)
    }
  }

  const avatarInitial = profile?.nickname?.[0] || '知'
  const streakDays = profile?.streak_days ?? Math.max(1, historyItems.length)

  return (
    <View className='profile-page'>
      {/* 个人档案头部卡 */}
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
          <Text className='profile-motto'>自适应刷题 · 长期抗遗忘闭环</Text>
        </View>
      </View>

      {/* 3 格纯学习核心数据（彻底去除 XP） */}
      <View className='stat-grid-3'>
        <View className='stat-box'>
          <Text className='stat-lbl'>连续打卡</Text>
          <Text className='stat-num'>{streakDays} 天</Text>
        </View>
        <View className='stat-box'>
          <Text className='stat-lbl'>累计答对</Text>
          <Text className='stat-num'>{profile?.correct_count ?? 0} 题</Text>
        </View>
        <View className='stat-box'>
          <Text className='stat-lbl'>平均正确率</Text>
          <Text className='stat-num'>{profile?.average_accuracy ?? 0}%</Text>
        </View>
      </View>

      {/* DAYPATCH 打卡印章微条 */}
      <View className='zx-card stamp-card'>
        <View className='stamp-head'>
          <Text className='stamp-title'>本周学习印章</Text>
          <Text className='stamp-sub'>共测验 {profile?.quiz_count ?? 0} 局</Text>
        </View>
        <View className='stamp-grid'>
          {stampWeek.map((d, idx) => (
            <View key={`${d.date_num}-${idx}`} className='stamp-cell'>
              <Text className='stamp-wk'>{d.day_label}</Text>
              <View className={`stamp-badge ${d.is_today || d.completed_count > 0 ? 'is-yes' : ''}`}>
                <Text>{d.is_today ? 'YES!' : d.completed_count > 0 ? 'AHA' : d.date_num}</Text>
              </View>
            </View>
          ))}
        </View>
      </View>

      {/* ARQ 待复习错题队列 */}
      <View className='zx-card due-queue-card'>
        <View className='due-head'>
          <Text className='due-title'>待复习错题队列 ({dueReviews.total_due})</Text>
          {dueReviews.items.length > 0 && (
            <View className='btn-due-go zx-press' onClick={handleStartDueQueue}>
              <Text>{startingDueQuiz ? '组卷中...' : '一键复习 →'}</Text>
            </View>
          )}
        </View>
        {dueReviews.items.length === 0 ? (
          <Text className='due-empty'>目前没有到期的错题卡片，去首页发起新测验吧</Text>
        ) : (
          <View className='due-list'>
            {dueReviews.items.slice(0, 3).map((card) => (
              <View key={card.card_id} className='due-row'>
                <View className='due-domain'>
                  <Text>{card.domain_name}</Text>
                </View>
                <Text className='due-stem'>{card.stem}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* 历史记录 */}
      <View className='section-head'>
        <Text className='section-title'>历史练习档案</Text>
        <Text className='section-count'>共 {totalHistory} 条</Text>
      </View>

      {historyItems.length === 0 ? (
        <View className='zx-card empty-history'>
          <Text className='empty-text'>暂无历史记录，去首页开始第一轮自适应测验</Text>
        </View>
      ) : (
        <View className='history-list'>
          {historyItems.map((item) => {
            const acc = Math.round(item.accuracy)
            return (
              <View
                key={item.quiz_id}
                className='zx-card history-card zx-press'
                onClick={() => handleViewDetail(item.quiz_id)}
              >
                <View className='history-left'>
                  <Text className='history-title'>{item.title}</Text>
                  <Text className='history-meta'>
                    {item.created_at} · {item.question_count} 题
                  </Text>
                </View>
                <View className='acc-tag'>
                  <Text>{acc}%</Text>
                </View>
              </View>
            )
          })}
          {hasMore && (
            <View className='load-more zx-press' onClick={handleLoadMore}>
              <Text className='load-more-text'>{loadingMore ? '加载中...' : '加载更多'}</Text>
            </View>
          )}
        </View>
      )}

      {process.env.TARO_ENV === 'h5' && dockVisible && <FloatingDock activeKey='profile' />}
    </View>
  )
}
