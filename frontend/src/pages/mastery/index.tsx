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
  waitForLogin,
  type MasteryOverviewResponse,
  type DueReviewsResponse,
  type QuizHistoryItem,
  type KnowledgeDocumentItem,
} from '../../services/api'
import { setActiveQuizSession } from '../../services/quizSessionStore'
import { buildEmptyDueReviews, buildFallbackMasteryOverview } from '../../services/v2Adapters'
import RetentionCurveCanvas from '../../components/RetentionCurveCanvas'
import SevenDayRhythmBar from '../../components/SevenDayRhythmBar'
import FloatingDock from '../../components/FloatingDock'
import './index.scss'

export default function MasteryPage() {
  const [selectedDomainId, setSelectedDomainId] = useState<number | undefined>(undefined)
  const [overview, setOverview] = useState<MasteryOverviewResponse | null>(null)
  const [dueReviews, setDueReviews] = useState<DueReviewsResponse>(buildEmptyDueReviews())
  const [historyItems, setHistoryItems] = useState<QuizHistoryItem[]>([])
  const [docs, setDocs] = useState<KnowledgeDocumentItem[]>([])
  const [loadingQuiz, setLoadingQuiz] = useState(false)
  const [dockVisible, setDockVisible] = useState(true)

  const loadData = useCallback(async () => {
    await waitForLogin()
    const [masteryRes, dueRes, histRes, docsRes] = await Promise.all([
      getMasteryOverview(selectedDomainId),
      getDueReviews(15),
      getQuizHistory(1, 5).catch(() => null),
      getKnowledgeDocuments().catch(() => null),
    ])
    if (masteryRes) setOverview(masteryRes)
    if (dueRes) setDueReviews(dueRes)
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

  const handleStartReviewOrPractice = async () => {
    if (loadingQuiz) return
    setLoadingQuiz(true)
    try {
      const reviewIds = dueReviews.items.slice(0, 6).map((c) => c.card_id)
      const domainName = activeDomain?.name || '综合知识'
      const { task_id } = await generateQuizAsync({
        user_input:
          reviewIds.length > 0
            ? `针对到期薄弱点「${domainName}」进行间隔巩固复习`
            : `针对「${domainName}」提升记忆保持率，巩固中等与核心易错题`,
        question_count: activeDomain?.recommended_count ?? 5,
        adaptive_mode: true,
        domain_id: activeDomain?.domain_id,
        review_card_ids: reviewIds.length > 0 ? reviewIds : undefined,
      })

      const quizData = await pollQuizTask(task_id)
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

      <View
        className={`zx-btn-obsidian ${loadingQuiz ? 'is-disabled' : ''}`}
        onClick={handleStartReviewOrPractice}
      >
        <Text>
          {dueReviews.total_due > 0
            ? `开始清零 ${dueReviews.total_due} 道到期错题`
            : `按当前画像再刷一组「${activeDomain?.name || '精选'}」`}
        </Text>
        <Text>→</Text>
      </View>

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
