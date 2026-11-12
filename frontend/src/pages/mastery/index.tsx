import { useState, useCallback, useMemo } from 'react'
import { View, Text } from '@tarojs/components'
import Taro, { useDidHide, useDidShow } from '@tarojs/taro'
import {
  getMasteryOverview,
  getDueReviews,
  getQuizHistory,
  getKnowledgeDocuments,
  markQuestionForReview,
  waitForLogin,
  type MasteryOverviewResponse,
  type DueReviewsResponse,
  type DueReviewCardItem,
  type QuizHistoryItem,
  type KnowledgeDocumentItem,
} from '../../services/api'
import { setActiveQuizSession } from '../../services/quizSessionStore'
import {
  buildEmptyDueReviews,
  buildFallbackMasteryOverview,
  buildInstantReviewQuiz,
  invalidateSwrCache,
  readSwrCache,
  writeSwrCache,
} from '../../services/v2Adapters'
import {
  getBackgroundQuizState,
  startBackgroundQuizGeneration,
  subscribeBackgroundQuiz,
  type BackgroundQuizState,
} from '../../services/backgroundQuizManager'
import RetentionCurveCanvas from '../../components/RetentionCurveCanvas'
import SevenDayRhythmBar from '../../components/SevenDayRhythmBar'
import FloatingDock from '../../components/FloatingDock'
import BackgroundTaskPill from '../../components/BackgroundTaskPill'
import './index.scss'

export default function MasteryPage() {
  const [selectedDomainId, setSelectedDomainId] = useState<number | undefined>(undefined)
  const [selectedWeekDayIdx, setSelectedWeekDayIdx] = useState<number | null>(null)
  const [overview, setOverview] = useState<MasteryOverviewResponse | null>(
    () => readSwrCache<MasteryOverviewResponse>('mastery_ov_all'),
  )
  const [dueReviews, setDueReviews] = useState<DueReviewsResponse>(
    () => readSwrCache<DueReviewsResponse>('mastery_due_all') || buildEmptyDueReviews(),
  )
  const [historyItems, setHistoryItems] = useState<QuizHistoryItem[]>([])
  const [docs, setDocs] = useState<KnowledgeDocumentItem[]>([])
  const [expandedCardId, setExpandedCardId] = useState<number | null>(null)
  const [bgQuiz, setBgQuiz] = useState<BackgroundQuizState>(() => getBackgroundQuizState())
  const [dockVisible, setDockVisible] = useState(true)

  const loadData = useCallback(async () => {
    await waitForLogin()
    const keySuffix = selectedDomainId ? String(selectedDomainId) : 'all'
    const cachedOv = readSwrCache<MasteryOverviewResponse>(`mastery_ov_${keySuffix}`)
    const cachedDue = readSwrCache<DueReviewsResponse>(`mastery_due_${keySuffix}`)
    if (cachedOv) setOverview(cachedOv)
    if (cachedDue) setDueReviews(cachedDue)

    const [masteryRes, dueRes, histRes, docsRes] = await Promise.all([
      getMasteryOverview(selectedDomainId),
      getDueReviews(15, { domainId: selectedDomainId, includeAll: true }),
      getQuizHistory(1, 5).catch(() => null),
      getKnowledgeDocuments().catch(() => null),
    ])
    if (masteryRes) {
      setOverview(masteryRes)
      writeSwrCache(`mastery_ov_${keySuffix}`, masteryRes)
    }
    if (dueRes) {
      setDueReviews(dueRes)
      writeSwrCache(`mastery_due_${keySuffix}`, dueRes)
    }
    if (histRes) setHistoryItems(histRes.items)
    if (docsRes) setDocs(docsRes.items)
  }, [selectedDomainId])

  useDidShow(() => {
    setDockVisible(true)
    Taro.eventCenter.trigger('zx:tab-change', 'mastery')
    void loadData()
    return subscribeBackgroundQuiz(setBgQuiz)
  })

  useDidHide(() => {
    setDockVisible(false)
  })

  const effectiveOverview = useMemo(
    () => overview ?? buildFallbackMasteryOverview(historyItems, docs),
    [overview, historyItems, docs],
  )

  const activeDomain = useMemo(() => {
    if (!selectedDomainId) return effectiveOverview.focus_domain || effectiveOverview.domains[0]
    return (
      effectiveOverview.domains.find((d) => d.domain_id === selectedDomainId) ||
      effectiveOverview.focus_domain
    )
  }, [selectedDomainId, effectiveOverview])

  const weeklyDays = effectiveOverview.weekly_rhythm || []
  const resolvedDayIdx = useMemo(() => {
    if (selectedWeekDayIdx !== null && weeklyDays[selectedWeekDayIdx]) {
      return selectedWeekDayIdx
    }
    let lastActive = -1
    weeklyDays.forEach((d, idx) => {
      if ((d.completed_count || 0) > 0) lastActive = idx
    })
    if (lastActive >= 0) return lastActive
    const todayIdx = weeklyDays.findIndex((d) => d.is_today)
    return todayIdx >= 0 ? todayIdx : 0
  }, [selectedWeekDayIdx, weeklyDays])

  const activeDay = weeklyDays[resolvedDayIdx]
  const totalWeekQuestions = useMemo(
    () => weeklyDays.reduce((sum, d) => sum + (d.completed_count || 0), 0),
    [weeklyDays],
  )
  const nextPlan = effectiveOverview.next_plan

  const handleInstantReview = (cards?: DueReviewCardItem[]) => {
    const targetCards = cards || dueReviews.items.slice(0, 6)
    if (targetCards.length === 0) return
    const instantQuiz = buildInstantReviewQuiz(targetCards, activeDomain?.name)
    setActiveQuizSession(instantQuiz, [])
    Taro.navigateTo({
      url: `/pages/quiz/index?quizId=${encodeURIComponent(instantQuiz.quiz_id)}`,
    })
  }

  const handleStartAiPractice = (cards?: DueReviewCardItem[]) => {
    const targetCards = cards || dueReviews.items.slice(0, 6)
    const reviewIds = cards ? targetCards.map((c) => c.card_id) : []
    const domainName = activeDomain?.name || nextPlan?.domain_name || '综合知识'
    const recCount =
      reviewIds.length > 0
        ? Math.max(1, reviewIds.length)
        : nextPlan?.recommended_count || activeDomain?.recommended_count || 5

    void startBackgroundQuizGeneration({
      user_input:
        reviewIds.length > 0
          ? `针对到期薄弱点「${domainName}」进行变式间隔巩固复习`
          : `针对「${domainName}」按记忆曲线节奏（${nextPlan?.focus_difficulty || '中等进阶'}）巩固核心考点`,
      question_count: recCount,
      adaptive_mode: reviewIds.length === 0,
      domain_id: activeDomain?.domain_id,
      enable_web_search: true,
      review_card_ids: reviewIds.length > 0 ? reviewIds : undefined,
      displayTopic: `${domainName} · ${recCount}题`,
      initiatedRoute: 'pages/mastery/index',
    })
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
    setDueReviews((prev) => ({
      ...prev,
      total_due: card.status === 'due' ? Math.max(0, prev.total_due - 1) : prev.total_due,
      unresolved_total: Math.max(0, (prev.unresolved_total ?? prev.items.length) - 1),
      items: prev.items.filter((x) => x.card_id !== card.card_id),
    }))
    invalidateSwrCache('home_')
    invalidateSwrCache('profile_')
    invalidateSwrCache('mastery_')
    Taro.showToast({ title: '已移出错题队列', icon: 'success' })
  }

  return (
    <View className='mastery-page'>
      <View className='mastery-header'>
        <Text className='mastery-kicker'>MEMORY RETENTION</Text>
        <Text className='mastery-title'>学习记忆曲线与能力图谱</Text>
      </View>

      {/* 领域筛选胶囊 */}
      <View className='domain-pills'>
        <View
          className={`domain-pill zx-press ${selectedDomainId === undefined ? 'is-on' : ''}`}
          onClick={() => setSelectedDomainId(undefined)}
        >
          <Text>全部域</Text>
        </View>
        {effectiveOverview.domains.map((dom) => (
          <View
            key={dom.domain_id}
            className={`domain-pill zx-press ${selectedDomainId === dom.domain_id ? 'is-on' : ''}`}
            onClick={() => setSelectedDomainId(dom.domain_id)}
          >
            <Text>{dom.name}</Text>
          </View>
        ))}
      </View>

      {/* 3 格核心记忆指标 */}
      <View className='stat-grid-3'>
        <View className='stat-box'>
          <Text className='stat-lbl'>总体保持率</Text>
          <Text className='stat-num'>{Math.round(effectiveOverview.overall_retention)}%</Text>
        </View>
        <View className='stat-box'>
          <Text className='stat-lbl'>当前待复习</Text>
          <Text className='stat-num'>{dueReviews.total_due || effectiveOverview.due_review_total} 题</Text>
        </View>
        <View className='stat-box'>
          <Text className='stat-lbl'>连续复习</Text>
          <Text className='stat-num'>{effectiveOverview.streak_days} 天</Text>
        </View>
      </View>

      {/* 学习记忆曲线卡片 */}
      <View className='zx-card curve-panel'>
        <View className='panel-head'>
          <Text className='panel-title'>
            {activeDomain ? `${activeDomain.name} · 记忆曲线` : '学习记忆曲线 · R(t) = e^(-t/S)'}
          </Text>
          <Text className='panel-warn'>50% 临界提醒</Text>
        </View>
        <RetentionCurveCanvas
          canvasId='mastery-retention-canvas'
          points={effectiveOverview.retention_curve}
        />
        <View className='curve-legend'>
          <View className='legend-item'>
            <View className='legend-line is-solid' />
            <Text>实测与巩固轨迹</Text>
          </View>
          <View className='legend-item'>
            <View className='legend-line is-dashed' />
            <Text>未复习自然遗忘</Text>
          </View>
        </View>
      </View>

      {/* 曲线驱动日程与下次出题调度 */}
      {nextPlan && (
        <View className='zx-card schedule-card'>
          <View className='schedule-head'>
            <View className='schedule-badge'>
              <Text>下次安排 · {nextPlan.when_label}</Text>
            </View>
            <Text className='schedule-meta'>
              推荐 {nextPlan.recommended_count} 题 · {nextPlan.focus_difficulty}
            </Text>
          </View>
          <Text className='schedule-reason'>{nextPlan.reason}</Text>
          <View
            className='schedule-go zx-press'
            onClick={() => handleStartAiPractice()}
          >
            <Text>
              {bgQuiz.status === 'running'
                ? `正在后台生成中 (${bgQuiz.elapsedSec}s)...`
                : `按曲线安排出题 (${nextPlan.recommended_count} 题) →`}
            </Text>
          </View>
        </View>
      )}

      {/* 本周学习进度（已完成答题数 + 点击柱子看当日具体内容） */}
      <View className='zx-card curve-panel'>
        <View className='panel-head'>
          <Text className='panel-title'>本周完成题数</Text>
          <Text className='panel-sub'>共 {totalWeekQuestions} 题 · 点击柱子看明细</Text>
        </View>
        <SevenDayRhythmBar
          days={weeklyDays}
          selectedIndex={resolvedDayIdx}
          onSelectDay={(_day, idx) => setSelectedWeekDayIdx(idx)}
        />
        {activeDay && (
          <View className='week-drill-box'>
            <View className='week-drill-head'>
              <Text className='week-drill-title'>
                {activeDay.is_today ? '今日' : `周${activeDay.day_label}`}（{activeDay.date_num}日）· 完成{' '}
                {activeDay.completed_count} 题
              </Text>
              {typeof activeDay.avg_accuracy === 'number' && (
                <Text className='week-drill-acc'>平均正确率 {Math.round(activeDay.avg_accuracy)}%</Text>
              )}
            </View>
            {activeDay.sessions && activeDay.sessions.length > 0 ? (
              <View className='week-session-list'>
                {activeDay.sessions.map((sess) => (
                  <View
                    key={sess.quiz_id}
                    className='week-session-row zx-press'
                    onClick={() =>
                      Taro.navigateTo({
                        url: `/pages/report/index?quizId=${encodeURIComponent(sess.quiz_id)}`,
                      })
                    }
                  >
                    <View className='week-sess-left'>
                      <Text className='week-sess-title'>{sess.title}</Text>
                      <Text className='week-sess-sub'>
                        {sess.domain_name} · {sess.question_count} 题
                        {sess.weak_points.length > 0
                          ? ` · 重点：${sess.weak_points.join('、')}`
                          : ''}
                      </Text>
                    </View>
                    <Text className='week-sess-acc'>{Math.round(sess.accuracy)}%</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text className='week-drill-empty'>当日暂无已交卷记录</Text>
            )}
          </View>
        )}
      </View>

      {/* 三维难度掌握分布 */}
      {activeDomain && (
        <View className='zx-card curve-panel'>
          <View className='panel-head'>
            <Text className='panel-title'>{activeDomain.name} · 难度掌握度</Text>
            <Text className='panel-sub'>稳定性 S = {activeDomain.stability_days} 天</Text>
          </View>
          <View className='diff-bars'>
            <View className='diff-row'>
              <Text className='diff-name'>基础</Text>
              <View className='diff-track'>
                <View
                  className='diff-fill is-easy'
                  style={{ width: `${Math.round(activeDomain.difficulty_stats.easy_accuracy)}%` }}
                />
              </View>
              <Text className='diff-pct'>{Math.round(activeDomain.difficulty_stats.easy_accuracy)}%</Text>
            </View>
            <View className='diff-row'>
              <Text className='diff-name'>中等</Text>
              <View className='diff-track'>
                <View
                  className='diff-fill is-medium'
                  style={{ width: `${Math.round(activeDomain.difficulty_stats.medium_accuracy)}%` }}
                />
              </View>
              <Text className='diff-pct'>{Math.round(activeDomain.difficulty_stats.medium_accuracy)}%</Text>
            </View>
            <View className='diff-row'>
              <Text className='diff-name'>困难</Text>
              <View className='diff-track'>
                <View
                  className='diff-fill is-hard'
                  style={{ width: `${Math.round(activeDomain.difficulty_stats.hard_accuracy)}%` }}
                />
              </View>
              <Text className='diff-pct'>{Math.round(activeDomain.difficulty_stats.hard_accuracy)}%</Text>
            </View>
          </View>
        </View>
      )}

      {/* 待复习错题手风琴清单 */}
      {dueReviews.items.length > 0 && (
        <View className='zx-card curve-panel'>
          <View className='panel-head'>
            <Text className='panel-title'>待巩固错题 ({dueReviews.items.length})</Text>
            <Text className='panel-sub'>点击展开答案与解析</Text>
          </View>
          <View className='mastery-due-list'>
            {dueReviews.items.slice(0, 8).map((card) => {
              const isOpen = expandedCardId === card.card_id
              return (
                <View key={card.card_id} className='mastery-due-item'>
                  <View
                    className='mastery-due-head zx-press'
                    onClick={() => setExpandedCardId(isOpen ? null : card.card_id)}
                  >
                    <View className='mastery-due-meta'>
                      <Text className='mastery-due-domain'>{card.domain_name}</Text>
                      <Text className='mastery-due-round'>第 {(card.repetitions || 0) + 1}/3 轮</Text>
                    </View>
                    <Text className={`mastery-due-stem ${isOpen ? 'is-open' : ''}`}>{card.stem}</Text>
                  </View>
                  {isOpen && (
                    <View className='mastery-due-body'>
                      {card.options?.map((opt) => {
                        const isOk = (card.answer || []).includes(opt.key)
                        const isWrong = (card.user_selected || []).includes(opt.key) && !isOk
                        return (
                          <Text
                            key={opt.key}
                            className={`mastery-due-opt ${isOk ? 'is-ok' : isWrong ? 'is-wrong' : ''}`}
                          >
                            {opt.key}. {opt.text}
                            {isOk ? ' ✓' : isWrong ? ' (曾错选)' : ''}
                          </Text>
                        )
                      })}
                      {card.explanation && (
                        <Text className='mastery-due-explain'>{card.explanation}</Text>
                      )}
                      <View className='mastery-due-btns'>
                        <View
                          className='md-btn is-dark zx-press'
                          onClick={() => handleInstantReview([card])}
                        >
                          <Text>秒开重做</Text>
                        </View>
                        <View
                          className='md-btn is-blue zx-press'
                          onClick={() => handleStartAiPractice([card])}
                        >
                          <Text>AI 变式</Text>
                        </View>
                        <View
                          className='md-btn is-light zx-press'
                          onClick={() => handleMarkMastered(card)}
                        >
                          <Text>已掌握</Text>
                        </View>
                      </View>
                    </View>
                  )}
                </View>
              )
            })}
          </View>
        </View>
      )}

      {dueReviews.items.length > 0 ? (
        <View className='mastery-cta-stack'>
          <View className='zx-btn-obsidian' onClick={() => handleInstantReview()}>
            <Text>秒开清零 {dueReviews.total_due || dueReviews.items.length} 道错题</Text>
            <Text>→</Text>
          </View>
          <View
            className='btn-secondary-ai zx-press'
            onClick={() => handleStartAiPractice(dueReviews.items.slice(0, 6))}
          >
            <Text>
              {bgQuiz.status === 'running'
                ? `后台变式组卷中 (${bgQuiz.elapsedSec}s)...`
                : 'AI 基于错题生成变式拓展测验'}
            </Text>
          </View>
        </View>
      ) : (
        <View
          className='zx-btn-obsidian'
          onClick={() => handleStartAiPractice()}
        >
          <Text>
            {bgQuiz.status === 'running'
              ? `后台出题中 (${bgQuiz.elapsedSec}s)...`
              : `按当前画像再刷一组「${activeDomain?.name || '精选'}」`}
          </Text>
          <Text>→</Text>
        </View>
      )}

      <BackgroundTaskPill visible={dockVisible} />

      {process.env.TARO_ENV === 'h5' && dockVisible && <FloatingDock activeKey='mastery' />}
    </View>
  )
}
