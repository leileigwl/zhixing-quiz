import { useState, useEffect, useMemo } from 'react'
import { View, Text, Image } from '@tarojs/components'
import Taro, { useRouter } from '@tarojs/taro'
import {
  submitQuizReport,
  pollReportStatus,
  getQuizDetail,
  getCachedUser,
  setCachedUser,
} from '../../services/api'
import type { QuizData, AnswerRecord, ReportData, ReportStatusEnum } from '../../services/api'
import { getActiveQuizSession } from '../../services/quizSessionStore'
import './index.scss'

function getHeadingByAccuracy(acc: number): string {
  if (acc >= 100) return '🎉 满分通关，掌握得非常扎实！'
  if (acc >= 80) return '💪 掌握扎实，继续突破薄弱点！'
  if (acc >= 60) return '👍 基础已稳，查漏补缺会更快！'
  if (acc >= 40) return '📚 还有提升空间，建议重刷错题！'
  return '🌱 先看薄弱解析，再来一轮巩固吧！'
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
  } | null>(null)
  const [report, setReport] = useState<ReportData | null>(null)
  const [reportStatus, setReportStatus] = useState<ReportStatusEnum | 'idle'>('idle')
  const [reportError, setReportError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [xpGain, setXpGain] = useState<number | null>(null)
  const [alreadySubmitted, setAlreadySubmitted] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)

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
          setReportError(res.error_message || 'AI 复盘报告暂未生成成功')
        }
      } catch (err: any) {
        if (cancelled) return
        setReportStatus('failed')
        setReportError(err?.message || 'AI 复盘报告生成超时，请稍后在历史记录中查看')
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
          if (res.xp_awarded && res.xp_gain > 0) {
            const cached = getCachedUser()
            if (cached) {
              setCachedUser({
                ...cached,
                total_xp: cached.total_xp + res.xp_gain,
              })
            }
          }
          if (cancelled) return

          setServerStats({
            accuracy: res.accuracy,
            correctCount: res.correct_count,
            wrongCount: res.wrong_count,
          })
          setXpGain(res.xp_gain)
          setAlreadySubmitted(res.already_submitted)
          setReportStatus(res.report_status)
          setLoading(false)

          if (res.report_status === 'completed' && res.report) {
            setReport(res.report)
            setReportError(null)
          } else if (res.report_status === 'failed') {
            setReportError(res.error_message || 'AI 复盘报告暂未生成成功')
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
        .then((detail) => {
          if (cancelled) return
          setQuizData({
            quiz_id: detail.quiz_id,
            title: detail.title,
            summary: detail.summary,
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
            setReportError(detail.report_error || 'AI 复盘报告暂未生成成功')
          } else {
            setReportStatus('idle')
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

  const correctCount = serverStats?.correctCount ?? localCorrectCount
  const wrongCount = serverStats?.wrongCount ?? localWrongCount
  const accuracy = report?.accuracy ?? serverStats?.accuracy ?? localAccuracy

  const handleShareQuote = () => {
    const quote = report?.share_quote || '不是所有的努力都会立刻回报，但所有的成长都值得被记录。'
    Taro.setClipboardData({
      data: quote,
      success: () => {
        Taro.showToast({ title: '金句已复制，快去分享吧', icon: 'success' })
      },
    })
  }

  return (
    <View className='report-page'>
      {/* 正确率圆环 */}
      <View className='report-ring-wrap'>
        <View
          className='ring-outer'
          style={{
            background: `conic-gradient(#10b981 0 ${accuracy}%, #e2e8f0 ${accuracy}% 100%)`,
          }}
        >
          <View className='ring-inner'>
            <Text className='ring-pct'>{accuracy}%</Text>
            <Text className='ring-label'>正确率</Text>
          </View>
        </View>
        {xpGain !== null && (
          <View className='xp-gain-pill'>
            <Text>
              {alreadySubmitted && xpGain === 0
                ? '本局成绩已结算 · 经验不重复发放'
                : `本局经验 +${xpGain} XP`}
            </Text>
          </View>
        )}
      </View>

      {/* 对错统计 */}
      <View className='stat-pair'>
        <View className='stat-tile is-green'>
          <Text>✓ 答对 {correctCount} 题</Text>
        </View>
        <View className='stat-tile is-red'>
          <Text>✕ 答错 {wrongCount} 题</Text>
        </View>
      </View>

      <Text className='report-encourage'>{getHeadingByAccuracy(accuracy)}</Text>

      {loading ? (
        <View className='zx-card report-loading'>
          <Text className='report-loading-text'>正在快速结算成绩...</Text>
        </View>
      ) : (
        <>
          {reportStatus === 'generating' && !report && (
            <View className='zx-card report-block report-ai-skeleton'>
              <Text className='report-subhead'>AI 复盘报告生成中</Text>
              <Text className='report-ai-hint'>
                客观判分与经验值已即时完成，AI 正在提炼薄弱知识点与学习建议...
              </Text>
              <View className='skeleton-line is-long' />
              <View className='skeleton-line is-mid' />
              <View className='skeleton-line is-short' />
            </View>
          )}

          {reportStatus === 'failed' && !report && (
            <View className='zx-card report-block report-ai-failed'>
              <Text className='report-subhead'>AI 复盘总结</Text>
              <Text className='report-ai-failed-text'>
                {reportError || 'AI 复盘总结暂未生成成功，客观成绩与解析已完整保存。'}
              </Text>
            </View>
          )}

          {/* 掌握与薄弱知识点标签 */}
          {(report?.mastered_points?.length || report?.weak_points?.length) ? (
            <View className='zx-card report-block'>
              {report?.mastered_points && report.mastered_points.length > 0 && (
                <View className='kp-section'>
                  <Text className='report-subhead'>掌握较好</Text>
                  <View className='pill-group'>
                    {report.mastered_points.map((p, idx) => (
                      <View key={idx} className='pill-green'>
                        <Text>{p}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}
              {report?.weak_points && report.weak_points.length > 0 && (
                <View className='kp-section-last'>
                  <Text className='report-subhead'>薄弱知识点</Text>
                  <View className='pill-group'>
                    {report.weak_points.map((p, idx) => (
                      <View key={idx} className='pill-red'>
                        <Text>{p}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </View>
          ) : null}

          {/* 三句总结与下一步建议 */}
          {(report?.three_line_summary?.length || report?.advice?.length) ? (
            <View className='zx-card report-block'>
              {report?.three_line_summary && report.three_line_summary.length > 0 && (
                <View>
                  <Text className='report-subhead'>三句核心总结</Text>
                  {report.three_line_summary.map((line, i) => (
                    <Text key={i} className='summary-line'>
                      {i + 1}. {line}
                    </Text>
                  ))}
                </View>
              )}
              {report?.three_line_summary?.length && report?.advice?.length ? (
                <View className='block-divider' />
              ) : null}
              {report?.advice && report.advice.length > 0 && (
                <View>
                  <Text className='report-subhead'>下一步建议</Text>
                  {report.advice.map((item, i) => (
                    <Text key={i} className='summary-line'>
                      • {item}
                    </Text>
                  ))}
                </View>
              )}
            </View>
          ) : null}

          {/* 今日学习金句 */}
          <View className='quote-card'>
            <View className='quote-head'>
              <Text className='quote-title'>今日学习金句</Text>
              <View className='share-pill' onClick={handleShareQuote}>
                <Text>分享</Text>
              </View>
            </View>
            <Text className='quote-text'>
              “{report?.share_quote || '不是所有的努力都会立刻回报，但所有的成长都值得被记录。'}”
            </Text>
          </View>

          {/* 可折叠题目回顾 */}
          {quizData?.questions && quizData.questions.length > 0 && (
            <View className='zx-card report-block'>
              <View className='review-toggle' onClick={() => setReviewOpen((prev) => !prev)}>
                <Text className='report-subhead' style={{ marginBottom: 0 }}>
                  题目回顾 ({quizData.questions.length} 题)
                </Text>
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
                          <Text className={`review-status ${rec.is_correct ? 'is-green' : 'is-red'}`}>
                            {rec.is_correct ? '✓ 回答正确' : '✕ 回答错误'}（正确答案：{q.answer.join('、')}）
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

      <View className='sticky-footer'>
        <View
          className='zx-btn-primary'
          onClick={() => Taro.switchTab({ url: '/pages/index/index' })}
        >
          <Text>返回首页</Text>
        </View>
      </View>
    </View>
  )
}
