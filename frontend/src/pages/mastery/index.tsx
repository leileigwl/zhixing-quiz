import { useState, useCallback, useMemo } from 'react'
import { View, Text } from '@tarojs/components'
import Taro, { useDidHide, useDidShow } from '@tarojs/taro'
import {
  getMasteryOverview,
  getDueReviews,
  getQuizHistory,
  getKnowledgeDocuments,
  generateQuizAsync,
  pollQuizTask,
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
import RetentionCurveCanvas from '../../components/RetentionCurveCanvas'
import SevenDayRhythmBar from '../../components/SevenDayRhythmBar'
import FloatingDock from '../../components/FloatingDock'
import './index.scss'

export default function MasteryPage() {
  const [selectedDomainId, setSelectedDomainId] = useState<number | undefined>(undefined)
  const [overview, setOverview] = useState<MasteryOverviewResponse | null>(
    () => readSwrCache<MasteryOverviewResponse>('mastery_ov_all'),
  )
  const [dueReviews, setDueReviews] = useState<DueReviewsResponse>(
    () => readSwrCache<DueReviewsResponse>('mastery_due_all') || buildEmptyDueReviews(),
  )
  const [historyItems, setHistoryItems] = useState<QuizHistoryItem[]>([])
  const [docs, setDocs] = useState<KnowledgeDocumentItem[]>([])
  const [expandedCardId, setExpandedCardId] = useState<number | null>(null)
  const [loadingQuiz, setLoadingQuiz] = useState(false)
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

  const forecastNext = effectiveOverview.seven_day_forecast[0] ?? dueReviews.total_due

  const handleInstantReview = (cards?: DueReviewCardItem[]) => {
    const targetCards = cards || dueReviews.items.slice(0, 6)
    if (targetCards.length === 0) return
    const instantQuiz = buildInstantReviewQuiz(targetCards, activeDomain?.name)
    setActiveQuizSession(instantQuiz, [])
    Taro.navigateTo({
      url: `/pages/quiz/index?quizId=${encodeURIComponent(instantQuiz.quiz_id)}`,
    })
  }

  const handleStartAiPractice = async (cards?: DueReviewCardItem[]) => {
    if (loadingQuiz) return
    setLoadingQuiz(true)
    try {
      const targetCards = cards || dueReviews.items.slice(0, 6)
      const reviewIds = targetCards.map((c) => c.card_id)
      const domainName = activeDomain?.name || '综合知识'
      const { task_id } = await generateQuizAsync({
        user_input:
          reviewIds.length > 0
            ? `针对到期薄弱点「${domainName}」进行变式间隔巩固复习`
            : `针对「${domainName}」提升记忆保持率，巩固中等与核心易错题`,
        question_count:
          reviewIds.length > 0 ? Math.max(1, reviewIds.length) : activeDomain?.recommended_count ?? 5,
        adaptive_mode: reviewIds.length === 0,
        domain_id: activeDomain?.domain_id,
        enable_web_search: true,
        review_card_ids: reviewIds.length > 0 ? reviewIds : undefined,
      })

      const quizData = await pollQuizTask(task_id)
      invalidateSwrCache('home_')
      setActiveQuizSession(quizData, [])
      Taro.navigateTo({
        url: `/pages/quiz/index?quizId=${encodeURIComponent(quizData.quiz_id)}`,
      })
    } catch (err: any) {
      Taro.showToast({ title: err?.message || '组卷失败，请稍后重试', icon: 'none' })
    } finally {
      setLoadingQuiz(false)
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
          <Text className='panel-title'>学习记忆曲线 · R(t) = e^(-t/S)</Text>
          <Text className='panel-warn'>50% 临界提醒</Text>
        </View>
        <RetentionCurveCanvas
          canvasId='mastery-retention-canvas'
          points={effectiveOverview.retention_curve}
        />
        <View className='curve-legend'>
          <View className='legend-item'>
            <View className='legend-line is-solid' />
            <Text>巩固后保持轨迹</Text>
          </View>
          <View className='legend-item'>
            <View className='legend-line is-dashed' />
            <Text>未复习遗忘参考</Text>
          </View>
        </View>
      </View>

      {/* MOVEPOP 本周复习节律 */}
      <View className='zx-card curve-panel'>
        <View className='panel-head'>
          <Text className='panel-title'>本周复习节律</Text>
          <Text className='panel-sub'>明日预测 {forecastNext} 题</Text>
        </View>
        <SevenDayRhythmBar days={effectiveOverview.weekly_rhythm} />
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
            className={`btn-secondary-ai zx-press ${loadingQuiz ? 'is-disabled' : ''}`}
            onClick={() => handleStartAiPractice()}
          >
            <Text>{loadingQuiz ? '正在变式组卷...' : 'AI 基于错题生成变式拓展测验'}</Text>
          </View>
        </View>
      ) : (
        <View
          className={`zx-btn-obsidian ${loadingQuiz ? 'is-disabled' : ''}`}
          onClick={() => handleStartAiPractice()}
        >
          <Text>按当前画像再刷一组「{activeDomain?.name || '精选'}」</Text>
          <Text>→</Text>
        </View>
      )}

      {process.env.TARO_ENV === 'h5' && dockVisible && <FloatingDock activeKey='mastery' />}

      {loadingQuiz && (
        <View className='zx-loading-overlay'>
          <View className='zx-loading-modal'>
            <View className='zx-spinner' />
            <Text className='zx-loading-title'>正在调取间隔复习题组</Text>
            <Text className='zx-loading-sub'>结合当前保持率与难度分布组卷中...</Text>
          </View>
        </View>
      )}
    </View>
  )
}
