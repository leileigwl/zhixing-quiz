import { useState, useEffect, useMemo } from 'react'
import { View, Text, Image } from '@tarojs/components'
import Taro, { useRouter } from '@tarojs/taro'
import {
  submitQuizReport,
  pollReportStatus,
  getQuizDetail,
  getMasteryOverview,
  grantSubscribeQuota,
  getCachedUser,
  setCachedUser,
  type QuizData,
  type AnswerRecord,
  type ReportData,
  type ReportStatusEnum,
  type MasteryOverviewResponse,
} from '../../services/api'
import { getActiveQuizSession } from '../../services/quizSessionStore'
import { buildFallbackMasteryOverview } from '../../services/v2Adapters'
import RetentionCurveCanvas from '../../components/RetentionCurveCanvas'
import SevenDayRhythmBar from '../../components/SevenDayRhythmBar'
import './index.scss'

function getEditorialHeadline(acc: number, wrongCount: number): string {
  if (acc >= 100) return '满分通关，本域记忆已非常稳固。'
  if (wrongCount > 0) return `今天定位并巩固了 ${wrongCount} 处盲区。`
  if (acc >= 80) return '基础扎实，保持当前复习节奏即可。'
  return '已定位薄弱知识点，先看解析再复习一遍。'
}

export default function ReportPage() {
  const router = useRouter()
  const quizIdParam = router.params.quizId ? decodeURIComponent(router.params.quizId) : ''

  const cachedSession = useMemo(() => getActiveQuizSession(quizIdParam), [quizIdParam])
  const hasFreshQuizData = Boolean(
    cachedSession.quizData && cachedSession.answerRecords.length > 0,
  )

  const [quizData, setQuizData] = useState<QuizData | null>(
    hasFreshQuizData ? cachedSession.quizData : null,
  )
  const [answerRecords, setAnswerRecords] = useState<AnswerRecord[]>(
    hasFreshQuizData ? cachedSession.answerRecords : [],
  )
  const [serverStats, setServerStats] = useState<{
    accuracy: number
    correctCount: number
    wrongCount: number
    streakDays?: number
    domainName?: string
  } | null>(null)
  const [report, setReport] = useState<ReportData | null>(null)
  const [reportStatus, setReportStatus] = useState<ReportStatusEnum | 'idle'>('idle')
  const [reportError, setReportError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [overview, setOverview] = useState<MasteryOverviewResponse | null>(null)
  const [subscribed, setSubscribed] = useState(false)

  const localCorrectCount = useMemo(
    () => answerRecords.filter((r) => r.is_correct).length,
    [answerRecords],
  )
  const localWrongCount = useMemo(
    () => answerRecords.filter((r) => !r.is_correct).length,
    [answerRecords],
  )
  const localAccuracy = useMemo(() => {
    if (answerRecords.length === 0) return 0
    return Math.round((localCorrectCount / answerRecords.length) * 100)
  }, [answerRecords.length, localCorrectCount])

  const avgDurationSec = useMemo(() => {
    if (answerRecords.length === 0) return 0
    const totalMs = answerRecords.reduce((sum, r) => sum + (r.duration_ms || 0), 0)
    return Math.max(1, Math.round(totalMs / answerRecords.length / 1000))
  }, [answerRecords])

  useEffect(() => {
    let cancelled = false

    const startAsyncReportPolling = async (targetQuizId: string) => {
      try {
        const res = await pollReportStatus(targetQuizId, undefined, {
          intervalMs: 2000,
          maxAttempts: 90,
          isCancelled: () => cancelled,
        })
        if (cancelled) return
        setReportStatus(res.report_status)
        if (res.report_status === 'completed' && res.report) {
          setReport(res.report)
          setReportError(null)
        } else if (res.report_status === 'failed') {
          setReportError(res.error_message || 'AI 复盘总结暂未生成成功')
        }
      } catch (err: any) {
        if (cancelled) return
        setReportStatus('failed')
        setReportError(err?.message || '复盘总结生成超时，客观成绩已保存')
      }
    }

    if (hasFreshQuizData && cachedSession.quizData) {
      const targetQuiz = cachedSession.quizData
      const targetRecords = cachedSession.answerRecords

      submitQuizReport({
        quiz_id: targetQuiz.quiz_id,
        answer_records: targetRecords,
      })
        .then((res) => {
          const cached = getCachedUser()
          if (cached && typeof res.streak_days === 'number') {
            setCachedUser({ ...cached, streak_days: res.streak_days })
          }
          if (cancelled) return

          setServerStats({
            accuracy: res.accuracy,
            correctCount: res.correct_count,
            wrongCount: res.wrong_count,
            streakDays: res.streak_days,
            domainName: res.domain_name,
          })
          setReportStatus(res.report_status)
          setLoading(false)

          getMasteryOverview().then((ov) => {
            if (!cancelled && ov) setOverview(ov)
          })

          if (res.report_status === 'completed' && res.report) {
            setReport(res.report)
            setReportError(null)
          } else if (res.report_status === 'failed') {
            setReportError(res.error_message || 'AI 复盘总结暂未生成成功')
          } else if (res.report_status === 'generating') {
            void startAsyncReportPolling(targetQuiz.quiz_id)
          }
        })
        .catch((err: any) => {
          if (cancelled) return
          setLoading(false)
          setReportStatus('failed')
          setReportError(err?.message || '交卷结算失败，请返回重试')
        })

      return () => {
        cancelled = true
      }
    }

    if (quizIdParam) {
      Promise.all([getQuizDetail(quizIdParam), getMasteryOverview()])
        .then(([detail, ov]) => {
          if (cancelled) return
          if (ov) setOverview(ov)
          setQuizData({
            quiz_id: detail.quiz_id,
            title: detail.title,
            summary: detail.summary,
            domain_name: detail.domain_name,
            questions: detail.questions,
            image_status: detail.image_status,
            image_notice: detail.image_notice,
          })
          if (detail.answer_records) setAnswerRecords(detail.answer_records)
          setLoading(false)

          if (detail.report) {
            setReport(detail.report)
            setReportStatus('completed')
            setReportError(null)
          } else if (detail.report_status === 'generating') {
            setReportStatus('generating')
            void startAsyncReportPolling(detail.quiz_id)
          } else if (detail.report_status === 'failed') {
            setReportStatus('failed')
            setReportError(detail.report_error || 'AI 复盘总结暂未生成成功')
          }
        })
        .catch(() => {
          if (!cancelled) setLoading(false)
        })

      return () => {
        cancelled = true
      }
    }

    setLoading(false)
    return () => {
      cancelled = true
    }
  }, [hasFreshQuizData, cachedSession, quizIdParam])

  const wrongCount = serverStats?.wrongCount ?? localWrongCount
  const accuracy = Math.round(report?.accuracy ?? serverStats?.accuracy ?? localAccuracy)
  const streakDays = serverStats?.streakDays ?? overview?.streak_days ?? 1

  const effectiveOverview = useMemo(
    () => overview ?? buildFallbackMasteryOverview([], []),
    [overview],
  )

  const handleEnableReminder = async () => {
    if (subscribed) return
    await grantSubscribeQuota({ count: 1, preferred_hour: 20 })
    setSubscribed(true)
    Taro.showToast({
      title: '已启用 ARQ 到期复习提醒',
      icon: 'success',
    })
  }

  const handleShareQuote = () => {
    const quote = report?.share_quote || '少一点题海消耗，把错题练进长期记忆。'
    Taro.setClipboardData({
      data: quote,
      success: () => Taro.showToast({ title: '金句已复制', icon: 'success' }),
    })
  }

  return (
    <View className='report-page'>
      <View className='report-head'>
        <Text className='report-kicker'>MEMORY RETENTION</Text>
        <Text className='report-title'>{getEditorialHeadline(accuracy, wrongCount)}</Text>
      </View>

      {/* 3 格纯核心指标（去 XP） */}
      <View className='stat-grid-3'>
        <View className='stat-box'>
          <Text className='stat-lbl'>本次准确率</Text>
          <Text className='stat-num'>{accuracy}%</Text>
        </View>
        <View className='stat-box'>
          <Text className='stat-lbl'>平均耗时</Text>
          <Text className='stat-num'>{avgDurationSec || 12}s</Text>
        </View>
        <View className='stat-box'>
          <Text className='stat-lbl'>连续复习</Text>
          <Text className='stat-num'>{streakDays} 天</Text>
        </View>
      </View>

      {/* 学习记忆曲线 */}
      <View className='zx-card report-panel'>
        <View className='panel-head'>
          <Text className='panel-title'>学习记忆曲线 · R(t) = e^(-t/S)</Text>
          <Text className='panel-warn'>50% 临界提醒</Text>
        </View>
        <RetentionCurveCanvas
          canvasId='report-retention-canvas'
          points={effectiveOverview.retention_curve}
        />
      </View>

      {/* 本周复习节律 */}
      <View className='zx-card report-panel'>
        <View className='panel-head'>
          <Text className='panel-title'>本周复习节律</Text>
          <Text className='panel-sub'>答对 {serverStats?.correctCount ?? localCorrectCount} · 错题 {wrongCount}</Text>
        </View>
        <SevenDayRhythmBar days={effectiveOverview.weekly_rhythm} />
      </View>

      {loading ? (
        <View className='zx-card report-panel'>
          <Text className='report-loading-txt'>正在结算交卷结果...</Text>
        </View>
      ) : (
        <>
          {reportStatus === 'generating' && !report && (
            <View className='zx-card report-panel'>
              <Text className='panel-title'>AI 复盘总结生成中...</Text>
              <Text className='summary-line'>客观算分已完成，正在提炼掌握点与后续训练重点。</Text>
            </View>
          )}

          {reportStatus === 'failed' && !report && (
            <View className='zx-card report-panel'>
              <Text className='panel-title'>复盘小结</Text>
              <Text className='summary-line'>
                {reportError || 'AI 总结暂未返回，客观成绩与解析已完整保存。'}
              </Text>
            </View>
          )}

          {(report?.mastered_points?.length || report?.weak_points?.length) ? (
            <View className='zx-card report-panel'>
              {report?.mastered_points && report.mastered_points.length > 0 && (
                <View className='kp-group'>
                  <Text className='kp-title'>掌握稳固</Text>
                  <View className='kp-pills'>
                    {report.mastered_points.map((p, idx) => (
                      <View key={idx} className='kp-pill is-ok'>
                        <Text>{p}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}
              {report?.weak_points && report.weak_points.length > 0 && (
                <View className='kp-group'>
                  <Text className='kp-title'>重点加强</Text>
                  <View className='kp-pills'>
                    {report.weak_points.map((p, idx) => (
                      <View key={idx} className='kp-pill is-warn'>
                        <Text>{p}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </View>
          ) : null}

          {(report?.three_line_summary?.length || report?.advice?.length) ? (
            <View className='zx-card report-panel'>
              {report?.three_line_summary?.map((line, idx) => (
                <Text key={idx} className='summary-line'>
                  {idx + 1}. {line}
                </Text>
              ))}
              {report?.advice && report.advice.length > 0 && (
                <View className='advice-block'>
                  <Text className='kp-title'>下一步建议</Text>
                  {report.advice.map((a, idx) => (
                    <Text key={idx} className='summary-line'>
                      • {a}
                    </Text>
                  ))}
                </View>
              )}
            </View>
          ) : null}

          <View className='quote-banner zx-press' onClick={handleShareQuote}>
            <Text className='quote-text'>
              “{report?.share_quote || '少一点题海消耗，把错题练进长期记忆。'}”
            </Text>
            <Text className='quote-copy'>复制金句</Text>
          </View>

          {quizData?.questions && quizData.questions.length > 0 && (
            <View className='zx-card report-panel'>
              <View className='review-toggle' onClick={() => setReviewOpen((prev) => !prev)}>
                <Text className='panel-title'>题目解析回看 ({quizData.questions.length} 题)</Text>
                <Text className='review-arrow'>{reviewOpen ? '收起 ⌄' : '展开 ›'}</Text>
              </View>
              {reviewOpen && (
                <View className='review-list'>
                  {quizData.questions.map((q, i) => {
                    const rec = answerRecords.find((r) => r.question_id === q.id)
                    return (
                      <View key={q.id} className='review-item'>
                        <Text className='review-stem'>
                          {i + 1}. {q.stem}
                        </Text>
                        {q.image_url && (
                          <Image className='review-image' src={q.image_url} mode='aspectFit' />
                        )}
                        {rec && (
                          <Text className={`review-status ${rec.is_correct ? 'is-ok' : 'is-wrong'}`}>
                            {rec.is_correct ? '✓ 回答正确' : '✕ 回答错误'}（标准答案：{q.answer.join('、')}）
                          </Text>
                        )}
                        <Text className='review-explain'>{q.explanation}</Text>
                      </View>
                    )
                  })}
                </View>
              )}
            </View>
          )}
        </>
      )}

      {/* 底部操作区 */}
      <View className='report-footer'>
        <View
          className={`btn-remind zx-press ${subscribed ? 'is-done' : ''}`}
          onClick={handleEnableReminder}
        >
          <Text>{subscribed ? '✓ 已开启到期复习提醒' : '开启明日 ARQ 到期提醒'}</Text>
        </View>
        <View
          className='zx-btn-obsidian'
          onClick={() => Taro.switchTab({ url: '/pages/index/index' })}
        >
          <Text>返回今日首页</Text>
          <Text>→</Text>
        </View>
      </View>
    </View>
  )
}
