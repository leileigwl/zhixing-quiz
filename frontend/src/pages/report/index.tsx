import { useState, useEffect, useMemo, useRef } from 'react'
import { View, Text, Image } from '@tarojs/components'
import Taro, { useRouter } from '@tarojs/taro'
import { generateReport, getQuizDetail, getCachedUser, setCachedUser } from '../../services/api'
import type { QuizData, AnswerRecord, ReportData } from '../../services/api'
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
  const [report, setReport] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [xpGain, setXpGain] = useState<number | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  const loadedRef = useRef(false)

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
    if (loadedRef.current) return
    loadedRef.current = true

    if (hasFreshQuizData && cachedSession.quizData) {
      const targetQuiz = cachedSession.quizData
      const targetRecords = cachedSession.answerRecords

      generateReport({
        quiz_id: targetQuiz.quiz_id,
        topic: targetQuiz.title,
        questions: targetQuiz.questions,
        answer_records: targetRecords,
      })
        .then((data) => {
          setReport(data)
          const correct = targetRecords.filter((r) => r.is_correct).length
          const gained = 10 + correct * 2
          setXpGain(gained)
          const cached = getCachedUser()
          if (cached) {
            cached.total_xp += gained
            setCachedUser(cached)
          }
        })
        .catch(() => {
          setReport(null)
        })
        .finally(() => setLoading(false))
      return
    }

    if (quizIdParam) {
      getQuizDetail(quizIdParam)
        .then((detail) => {
          setQuizData({
            quiz_id: detail.quiz_id,
            title: detail.title,
            summary: detail.summary,
            questions: detail.questions,
          })
          if (detail.answer_records) setAnswerRecords(detail.answer_records)
          if (detail.report) setReport(detail.report)
        })
        .catch(() => {})
        .finally(() => setLoading(false))
      return
    }

    setLoading(false)
  }, [hasFreshQuizData, cachedSession, quizIdParam])

  const accuracy = report?.accuracy ?? localAccuracy

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
            <Text>本局经验 +{xpGain} XP</Text>
          </View>
        )}
      </View>

      {/* 对错统计 */}
      <View className='stat-pair'>
        <View className='stat-tile is-green'>
          <Text>✓ 答对 {localCorrectCount} 题</Text>
        </View>
        <View className='stat-tile is-red'>
          <Text>✕ 答错 {localWrongCount} 题</Text>
        </View>
      </View>

      <Text className='report-encourage'>{getHeadingByAccuracy(accuracy)}</Text>

      {loading ? (
        <View className='zx-card report-loading'>
          <Text className='report-loading-text'>AI 正在为你生成复盘报告...</Text>
        </View>
      ) : (
        <>
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
