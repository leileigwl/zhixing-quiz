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
  type RetentionCurvePoint,
  type WeeklyRhythmDay,
} from '../../services/api'
import { clearSavedDraftForQuiz, getActiveQuizSession } from '../../services/quizSessionStore'
import { buildFallbackMasteryOverview, invalidateSwrCache } from '../../services/v2Adapters'
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
    domainMasteryAfter?: number
    stabilityDaysAfter?: number
    dueCardsCreated?: number
  } | null>(null)
  const [selectedDayIdx, setSelectedDayIdx] = useState<number | null>(null)
  const [report, setReport] = useState<ReportData | null>(null)
  const [reportStatus, setReportStatus] = useState<ReportStatusEnum | 'idle'>('idle')
  const [reportError, setReportError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [overview, setOverview] = useState<MasteryOverviewResponse | null>(null)
  const [sessionCurve, setSessionCurve] = useState<RetentionCurvePoint[] | null>(null)
  const [sessionRhythm, setSessionRhythm] = useState<WeeklyRhythmDay[] | null>(null)
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
          intervalMs: 700,
          maxAttempts: 120,
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
          invalidateSwrCache('home_')
          invalidateSwrCache('mastery_')
          invalidateSwrCache('profile_')
          clearSavedDraftForQuiz(targetQuiz.quiz_id)
          if (cancelled) return

          setServerStats({
            accuracy: res.accuracy,
            correctCount: res.correct_count,
            wrongCount: res.wrong_count,
            streakDays: res.streak_days,
            domainName: res.domain_name,
            domainMasteryAfter: res.domain_mastery_after,
            stabilityDaysAfter: res.stability_days_after,
            dueCardsCreated: res.due_cards_created,
          })
          if (res.session_retention_curve && res.session_retention_curve.length >= 2) {
            setSessionCurve(res.session_retention_curve)
          }
          if (res.weekly_rhythm && res.weekly_rhythm.length === 7) {
            setSessionRhythm(res.weekly_rhythm)
          }
          setReportStatus(res.report_status)
          setLoading(false)

          const targetDomainId = res.domain_id ?? targetQuiz.domain_id
          getMasteryOverview(targetDomainId).then((ov) => {
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
      getQuizDetail(quizIdParam)
        .then(async (detail) => {
          if (cancelled) return
          setQuizData({
            quiz_id: detail.quiz_id,
            title: detail.title,
            summary: detail.summary,
            domain_id: detail.domain_id,
            domain_name: detail.domain_name,
            questions: detail.questions,
            image_status: detail.image_status,
            image_notice: detail.image_notice,
          })
          if (detail.answer_records) setAnswerRecords(detail.answer_records)
          setLoading(false)

          const ov = await getMasteryOverview(detail.domain_id)
          if (!cancelled && ov) setOverview(ov)

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

  const localWeakKps = useMemo(() => {
    if (!quizData?.questions) return [] as string[]
    const wrongIds = new Set(answerRecords.filter((r) => !r.is_correct).map((r) => r.question_id))
    const kps = quizData.questions
      .filter((q) => wrongIds.has(q.id) && q.knowledge_point)
      .map((q) => q.knowledge_point)
    return Array.from(new Set(kps)).slice(0, 3)
  }, [quizData, answerRecords])

  const localOkKps = useMemo(() => {
    if (!quizData?.questions) return [] as string[]
    const okIds = new Set(answerRecords.filter((r) => r.is_correct).map((r) => r.question_id))
    const kps = quizData.questions
      .filter((q) => okIds.has(q.id) && q.knowledge_point)
      .map((q) => q.knowledge_point)
    return Array.from(new Set(kps)).slice(0, 3)
  }, [quizData, answerRecords])

  const displayCurve =
    sessionCurve && sessionCurve.length >= 2 ? sessionCurve : effectiveOverview.retention_curve
  const displayRhythm =
    sessionRhythm && sessionRhythm.length === 7 ? sessionRhythm : effectiveOverview.weekly_rhythm
  const activeDayIdx = useMemo(() => {
    if (selectedDayIdx !== null && displayRhythm[selectedDayIdx]) return selectedDayIdx
    const todayIdx = displayRhythm.findIndex((d) => d.is_today)
    return todayIdx >= 0 ? todayIdx : 0
  }, [selectedDayIdx, displayRhythm])
  const activeDay = displayRhythm[activeDayIdx]
  const recoveryPt = displayCurve.find((p) => p.is_recovery)
  const totalQ = quizData?.questions?.length || answerRecords.length || 0
  const okQ = serverStats?.correctCount ?? localCorrectCount
  const domainLabel = serverStats?.domainName || quizData?.domain_name || '本次专题'
  const stabilityLabel =
    serverStats?.stabilityDaysAfter ?? effectiveOverview.focus_domain?.stability_days ?? 5
  const nextPlan = effectiveOverview.next_plan

  const handleEnableReminder = async () => {
    if (subscribed) return
    await grantSubscribeQuota({ count: 1, preferred_hour: 20 })
    setSubscribed(true)
    Taro.showToast({
      title: '已开启微信到期复习提醒',
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

      {/* 本次复盘一图看懂（人话三步结论：答得怎样 / 曲线原因 / 下次安排） */}
      <View className='zx-card digest-card'>
        <Text className='digest-head'>本次诊断结论</Text>
        <View className='digest-row'>
          <Text className='digest-num'>1</Text>
          <Text className='digest-txt'>
            「{domainLabel}」共 {totalQ} 题答对 {okQ} 题（{accuracy}%）
            {localWeakKps.length > 0
              ? `；重点失分在：${localWeakKps.join('、')}`
              : localOkKps.length > 0
                ? `；已稳固掌握：${localOkKps.join('、')}`
                : ''}。
          </Text>
        </View>
        <View className='digest-row'>
          <Text className='digest-num'>2</Text>
          <Text className='digest-txt'>
            曲线解说：本次巩固后预计短期保持率达{' '}
            {Math.round(recoveryPt?.retention_pct ?? accuracy)}%（记忆稳定性 S = {stabilityLabel}{' '}
            天），灰虚线代表不复习时的自然遗忘下滑。
          </Text>
        </View>
        <View className='digest-row'>
          <Text className='digest-num'>3</Text>
          <Text className='digest-txt'>
            后续安排：
            {wrongCount > 0
              ? `已将 ${wrongCount} 道错题设为「今日待巩固」，回首页或「曲线」即可 0.1s 秒开重练。`
              : nextPlan?.reason || `保持节奏，建议 ${nextPlan?.when_label || '按曲线提醒'} 再刷一组拔高。`}
          </Text>
        </View>
      </View>

      {/* 学习记忆曲线 */}
      <View className='zx-card report-panel'>
        <View className='panel-head'>
          <Text className='panel-title'>
            {serverStats?.domainName || quizData?.domain_name
              ? `${serverStats?.domainName || quizData?.domain_name} · 记忆曲线`
              : '学习记忆曲线 · R(t) = e^(-t/S)'}
          </Text>
          <Text className='panel-warn'>50% 临界提醒</Text>
        </View>
        <RetentionCurveCanvas
          canvasId='report-retention-canvas'
          points={displayCurve}
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

      {/* 本周复习节律 */}
      <View className='zx-card report-panel'>
        <View className='panel-head'>
          <Text className='panel-title'>本周完成题数</Text>
          <Text className='panel-sub'>
            答对 {serverStats?.correctCount ?? localCorrectCount} · 错题 {wrongCount}
          </Text>
        </View>
        <SevenDayRhythmBar
          days={displayRhythm}
          selectedIndex={activeDayIdx}
          onSelectDay={(_day, idx) => setSelectedDayIdx(idx)}
        />
        {activeDay && activeDay.sessions && activeDay.sessions.length > 0 && (
          <View className='report-day-summary'>
            <Text className='report-day-txt'>
              {activeDay.is_today ? '今日' : `周${activeDay.day_label}`}（{activeDay.date_num}日）累计完成{' '}
              {activeDay.completed_count} 题 · 共 {activeDay.quiz_count} 场测验
            </Text>
          </View>
        )}
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
          <Text>{subscribed ? '✓ 已开启微信复习提醒' : '开启微信复习提醒（明晚 20:00）'}</Text>
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
