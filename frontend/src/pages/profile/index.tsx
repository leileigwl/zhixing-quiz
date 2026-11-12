import { useState, useCallback, useMemo } from 'react'
import { View, Text, Image, Button, Input } from '@tarojs/components'
import Taro, { useDidHide, useDidShow } from '@tarojs/taro'
import {
  getUserProfile,
  getQuizHistory,
  getDueReviews,
  getMasteryOverview,
  markQuestionForReview,
  generateQuizAsync,
  pollQuizTask,
  updateUserProfile,
  setCachedUser,
  waitForLogin,
  type UserProfile,
  type QuizHistoryItem,
  type DueReviewsResponse,
  type DueReviewCardItem,
  type MasteryOverviewResponse,
} from '../../services/api'
import { setActiveQuizSession } from '../../services/quizSessionStore'
import {
  buildEmptyDueReviews,
  buildInstantReviewQuiz,
  buildRealCalendarStrip,
  invalidateSwrCache,
  readSwrCache,
  writeSwrCache,
} from '../../services/v2Adapters'
import FloatingDock from '../../components/FloatingDock'
import './index.scss'

export default function ProfilePage() {
  const [profile, setProfile] = useState<UserProfile | null>(
    () => readSwrCache<UserProfile>('profile_user'),
  )
  const [historyItems, setHistoryItems] = useState<QuizHistoryItem[]>(
    () => readSwrCache<QuizHistoryItem[]>('profile_history') || [],
  )
  const [dueReviews, setDueReviews] = useState<DueReviewsResponse>(
    () => readSwrCache<DueReviewsResponse>('profile_due') || buildEmptyDueReviews(),
  )
  const [overview, setOverview] = useState<MasteryOverviewResponse | null>(
    () => readSwrCache<MasteryOverviewResponse>('profile_overview'),
  )
  const [expandedCardId, setExpandedCardId] = useState<number | null>(null)
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
    const [data, dueRes, ovRes] = await Promise.all([
      getUserProfile().catch(() => null),
      getDueReviews(20, { includeAll: true }),
      getMasteryOverview(),
    ])
    if (data) {
      setProfile(data)
      writeSwrCache('profile_user', data)
      setCachedUser({
        id: data.id,
        nickname: data.nickname,
        avatar_url: data.avatar_url,
        total_xp: data.total_xp,
        streak_days: data.streak_days,
      })
    }
    if (dueRes) {
      setDueReviews(dueRes)
      writeSwrCache('profile_due', dueRes)
    }
    if (ovRes) {
      setOverview(ovRes)
      writeSwrCache('profile_overview', ovRes)
    }
  }, [])

  const loadHistory = useCallback(async (p: number, reset = false) => {
    await waitForLogin()
    setLoadingMore(true)
    try {
      const data = await getQuizHistory(p, 10)
      setHistoryItems((prev) => {
        const next = reset ? data.items : [...prev, ...data.items]
        if (reset) writeSwrCache('profile_history', next)
        return next
      })
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

  const stampWeek = useMemo(
    () =>
      overview?.weekly_rhythm?.length === 7
        ? buildRealCalendarStrip(overview.weekly_rhythm)
        : buildRealCalendarStrip(),
    [overview],
  )

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

  const handleInstantReviewCards = (cards: DueReviewCardItem[]) => {
    if (cards.length === 0) return
    const instantQuiz = buildInstantReviewQuiz(cards)
    setActiveQuizSession(instantQuiz, [])
    Taro.navigateTo({
      url: `/pages/quiz/index?quizId=${encodeURIComponent(instantQuiz.quiz_id)}`,
    })
  }

  const handleAiVariantCards = async (cards: DueReviewCardItem[]) => {
    if (startingDueQuiz || cards.length === 0) return
    setStartingDueQuiz(true)
    try {
      const ids = cards.slice(0, 6).map((c) => c.card_id)
      const topicNames = Array.from(new Set(cards.map((c) => c.domain_name))).join('、')
      const { task_id } = await generateQuizAsync({
        user_input: `针对错题「${topicNames || '核心薄弱点'}」生成举一反三变式强化测验`,
        question_count: Math.max(1, ids.length),
        adaptive_mode: false,
        enable_web_search: true,
        review_card_ids: ids,
      })
      const quizData = await pollQuizTask(task_id)
      invalidateSwrCache('home_')
      setActiveQuizSession(quizData, [])
      Taro.navigateTo({
        url: `/pages/quiz/index?quizId=${encodeURIComponent(quizData.quiz_id)}`,
      })
    } catch (err: any) {
      Taro.showToast({ title: err?.message || '调起变式复习失败', icon: 'none' })
    } finally {
      setStartingDueQuiz(false)
    }
  }

  const handleMarkMastered = async (card: DueReviewCardItem) => {
    const res = await markQuestionForReview({
      quiz_id: card.quiz_id,
      question_id: card.question_id,
      action: 'skip',
    })
    if (!res) {
      Taro.showToast({ title: '标记失败，请稍后重试', icon: 'none' })
      return
    }
    setDueReviews((prev) => {
      const filtered = prev.items.filter((x) => x.card_id !== card.card_id)
      const next = {
        ...prev,
        total_due: card.status === 'due' ? Math.max(0, prev.total_due - 1) : prev.total_due,
        unresolved_total: Math.max(0, (prev.unresolved_total ?? prev.items.length) - 1),
        items: filtered,
      }
      writeSwrCache('profile_due', next)
      return next
    })
    invalidateSwrCache('home_')
    invalidateSwrCache('mastery_')
    if (expandedCardId === card.card_id) setExpandedCardId(null)
    Taro.showToast({ title: '已标记掌握并移出队列', icon: 'success' })
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
          {stampWeek.map((d, idx) => {
            const done = d.completed_count > 0
            return (
              <View key={`${d.date_num}-${idx}`} className='stamp-cell'>
                <Text className='stamp-wk'>{d.day_label}</Text>
                <View
                  className={`stamp-badge ${done ? 'is-yes' : d.is_today ? 'is-today-idle' : ''}`}
                >
                  <Text>{d.is_today && done ? 'YES!' : done ? 'AHA' : d.is_today ? '今日' : d.date_num}</Text>
                </View>
              </View>
            )
          })}
        </View>
      </View>

      {/* ARQ 待复习错题本（支持手风琴展开选项/答案/解析 + 秒开回顾 + AI变式 + 掌握毕业） */}
      <View className='zx-card due-queue-card'>
        <View className='due-head'>
          <View>
            <Text className='due-title'>
              错题巩固本 ({dueReviews.total_due} 到期
              {typeof dueReviews.unresolved_total === 'number' &&
              dueReviews.unresolved_total > dueReviews.total_due
                ? ` / ${dueReviews.unresolved_total} 未毕业`
                : ''}
              )
            </Text>
          </View>
          {dueReviews.items.length > 0 && (
            <View className='due-head-btns'>
              <View
                className='btn-due-variant zx-press'
                onClick={() => handleAiVariantCards(dueReviews.items.slice(0, 6))}
              >
                <Text>{startingDueQuiz ? '组题中...' : 'AI 变式'}</Text>
              </View>
              <View
                className='btn-due-go zx-press'
                onClick={() => handleInstantReviewCards(dueReviews.items.slice(0, 6))}
              >
                <Text>秒开回顾 →</Text>
              </View>
            </View>
          )}
        </View>
        {dueReviews.items.length === 0 ? (
          <Text className='due-empty'>目前没有未掌握的错题卡片，去首页发起新测验吧</Text>
        ) : (
          <View className='due-list'>
            {dueReviews.items.map((card) => {
              const isOpen = expandedCardId === card.card_id
              const userSel = card.user_selected || []
              const rightAns = card.answer || []
              return (
                <View key={card.card_id} className={`due-card-box ${isOpen ? 'is-open' : ''}`}>
                  <View
                    className='due-row zx-press'
                    onClick={() => setExpandedCardId(isOpen ? null : card.card_id)}
                  >
                    <View className='due-row-top'>
                      <View className='due-domain'>
                        <Text>{card.domain_name}</Text>
                      </View>
                      <Text className='due-round-tag'>
                        第 {(card.repetitions || 0) + 1}/3 轮 ·{' '}
                        {card.status === 'due' ? '待今日巩固' : `${card.interval_days}天后再练`}
                      </Text>
                      <Text className='due-chevron'>{isOpen ? '⌄' : '›'}</Text>
                    </View>
                    <Text className={`due-stem ${isOpen ? 'is-expanded' : ''}`}>{card.stem}</Text>
                  </View>

                  {isOpen && (
                    <View className='due-expand-body'>
                      {card.options && card.options.length > 0 && (
                        <View className='due-opts'>
                          {card.options.map((opt) => {
                            const isCorrect = rightAns.includes(opt.key)
                            const isUserWrong = userSel.includes(opt.key) && !isCorrect
                            return (
                              <View
                                key={opt.key}
                                className={`due-opt-line ${isCorrect ? 'is-ok' : isUserWrong ? 'is-wrong' : ''}`}
                              >
                                <Text className='due-opt-txt'>
                                  {opt.key}. {opt.text}
                                </Text>
                                {isCorrect && <Text className='due-opt-tag is-ok'>✓ 正解</Text>}
                                {isUserWrong && <Text className='due-opt-tag is-wrong'>✕ 曾选</Text>}
                              </View>
                            )
                          })}
                        </View>
                      )}
                      {card.explanation && (
                        <Text className='due-explain'>解析：{card.explanation}</Text>
                      )}
                      <View className='due-card-actions'>
                        <View
                          className='due-act-btn is-primary zx-press'
                          onClick={() => handleInstantReviewCards([card])}
                        >
                          <Text>秒开重做</Text>
                        </View>
                        <View
                          className='due-act-btn is-blue zx-press'
                          onClick={() => handleAiVariantCards([card])}
                        >
                          <Text>AI 变式重练</Text>
                        </View>
                        <View
                          className='due-act-btn is-muted zx-press'
                          onClick={() => handleMarkMastered(card)}
                        >
                          <Text>我已掌握</Text>
                        </View>
                      </View>
                    </View>
                  )}
                </View>
              )
            })}
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
