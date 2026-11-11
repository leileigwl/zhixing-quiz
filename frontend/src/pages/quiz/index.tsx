import { useState, useMemo, useEffect, useRef } from 'react'
import { View, Text, Image } from '@tarojs/components'
import Taro, { useRouter } from '@tarojs/taro'
import {
  getQuizDetail,
  getQuizImages,
  type Question,
  type AnswerRecord,
  type QuizData,
  type QuizSourceType,
} from '../../services/api'
import {
  getActiveQuizSession,
  setActiveAnswerRecords,
  setActiveQuizSession,
  updateActiveQuizImages,
} from '../../services/quizSessionStore'
import './index.scss'

const DIFF_LABEL: Record<Question['difficulty'], string> = {
  easy: '基础题',
  medium: '中等难度',
  hard: '进阶难题',
}

const SOURCE_LABEL: Record<QuizSourceType, string> = {
  llm_direct: '大模型直出',
  kb_rag: '知识库匹配',
  web_search: '知识库 + 搜索核验',
}

export default function QuizPage() {
  const router = useRouter()
  const paramQuizId = router.params.quizId ? decodeURIComponent(router.params.quizId) : undefined

  const initialSession = useMemo(() => getActiveQuizSession(paramQuizId), [paramQuizId])
  const [quizData, setQuizData] = useState<QuizData | null>(initialSession.quizData)
  const [loadingDetail, setLoadingDetail] = useState(false)

  useEffect(() => {
    if (!quizData && paramQuizId) {
      setLoadingDetail(true)
      getQuizDetail(paramQuizId)
        .then((detail) => {
          const restored: QuizData = {
            quiz_id: detail.quiz_id,
            title: detail.title,
            summary: detail.summary,
            questions: detail.questions,
            source_type: detail.source_type,
            domain_name: detail.domain_name,
            image_status: detail.image_status,
            image_notice: detail.image_notice,
          }
          setQuizData(restored)
          setActiveQuizSession(restored, detail.answer_records || [])
          if (detail.answer_records?.length) {
            setAnswerRecords(detail.answer_records)
            const firstAns = detail.answer_records.find((r) => r.question_id === detail.questions[0]?.id)
            if (firstAns) {
              setSelectedAnswers(firstAns.selected_answers)
              setSubmitted(true)
              setExplainVisible(true)
              setIsReviewReadonly(true)
            }
          }
        })
        .catch(() => {})
        .finally(() => setLoadingDetail(false))
    }
  }, [quizData, paramQuizId])

  useEffect(() => {
    const activeQuizId = quizData?.quiz_id
    if (!activeQuizId || quizData?.image_status !== 'generating') {
      return
    }

    let cancelled = false
    let attempts = 0
    const maxAttempts = 60
    let timer: ReturnType<typeof setInterval> | null = null

    const stopPolling = () => {
      if (timer !== null) {
        clearInterval(timer)
        timer = null
      }
    }

    const fetchImages = async () => {
      if (cancelled) return
      attempts += 1
      try {
        const res = await getQuizImages(activeQuizId)
        if (cancelled) return

        const imageUrls = res.image_urls || {}
        const updated = updateActiveQuizImages(activeQuizId, {
          image_status: res.image_status,
          image_urls: imageUrls,
          image_notice: res.image_notice,
        })
        setQuizData((prev) => {
          if (!prev || prev.quiz_id !== activeQuizId) return prev
          if (updated) return updated
          return {
            ...prev,
            image_status: res.image_status,
            image_notice: res.image_notice,
            questions: prev.questions.map((q) =>
              imageUrls[q.id] && imageUrls[q.id] !== q.image_url
                ? { ...q, image_url: imageUrls[q.id] }
                : q,
            ),
          }
        })

        if (res.image_status !== 'generating' || attempts >= maxAttempts) {
          stopPolling()
        }
      } catch {
        if (attempts >= maxAttempts) {
          stopPolling()
        }
      }
    }

    timer = setInterval(fetchImages, 2500)
    void fetchImages()

    return () => {
      cancelled = true
      stopPolling()
    }
  }, [quizData?.quiz_id, quizData?.image_status])

  useEffect(() => {
    if (quizData?.title) {
      Taro.setNavigationBarTitle({ title: quizData.title.slice(0, 12) })
    }
  }, [quizData?.title])

  const questions = quizData?.questions || []
  const totalQuestions = questions.length

  const [currentIndex, setCurrentIndex] = useState(0)
  const [selectedAnswers, setSelectedAnswers] = useState<string[]>([])
  const [submitted, setSubmitted] = useState(false)
  const [explainVisible, setExplainVisible] = useState(false)
  const [isReviewReadonly, setIsReviewReadonly] = useState(false)
  const [answerRecords, setAnswerRecords] = useState<AnswerRecord[]>(
    initialSession.answerRecords || [],
  )
  const [startTime, setStartTime] = useState<number>(Date.now())
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (revealTimerRef.current) clearTimeout(revealTimerRef.current)
    }
  }, [])

  const currentQuestion: Question | undefined = questions[currentIndex]
  const currentRecord = useMemo(
    () => answerRecords.find((r) => r.question_id === currentQuestion?.id),
    [answerRecords, currentQuestion?.id],
  )

  const navigateToQuestion = (targetIdx: number) => {
    if (targetIdx < 0 || targetIdx >= totalQuestions) return
    if (revealTimerRef.current) {
      clearTimeout(revealTimerRef.current)
      revealTimerRef.current = null
    }
    const targetQ = questions[targetIdx]
    const existing = answerRecords.find((r) => r.question_id === targetQ?.id)
    setCurrentIndex(targetIdx)

    if (existing) {
      setSelectedAnswers(existing.selected_answers)
      setSubmitted(true)
      setExplainVisible(true)
      setIsReviewReadonly(true)
    } else {
      setSelectedAnswers([])
      setSubmitted(false)
      setExplainVisible(false)
      setIsReviewReadonly(false)
      setStartTime(Date.now())
    }
  }

  const handleOptionClick = (key: string) => {
    if (submitted || isReviewReadonly || !currentQuestion) return

    if (currentQuestion.type === 'multiple') {
      setSelectedAnswers((prev) =>
        prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
      )
    } else {
      setSelectedAnswers([key])
    }
  }

  const handleSubmit = () => {
    if (selectedAnswers.length === 0 || !currentQuestion || submitted) return

    const isCorrect =
      currentQuestion.answer.length === selectedAnswers.length &&
      currentQuestion.answer.every((a) => selectedAnswers.includes(a))

    const duration = Math.max(500, Date.now() - startTime)
    const record: AnswerRecord = {
      question_id: currentQuestion.id,
      selected_answers: [...selectedAnswers],
      is_correct: isCorrect,
      duration_ms: duration,
      mark_review: !isCorrect,
    }

    const updated = [...answerRecords]
    const existingIdx = updated.findIndex((r) => r.question_id === currentQuestion.id)
    if (existingIdx >= 0) {
      updated[existingIdx] = record
    } else {
      updated.push(record)
    }

    setAnswerRecords(updated)
    setActiveAnswerRecords(updated)
    setSubmitted(true)
    setExplainVisible(false)

    if (process.env.TARO_ENV === 'weapp') {
      Taro.vibrateShort({ type: 'light' }).catch(() => {})
    }

    // 220ms 缓冲后平滑展开解析卡片
    revealTimerRef.current = setTimeout(() => {
      setExplainVisible(true)
    }, 220)
  }

  const handleToggleMarkReview = () => {
    if (!currentQuestion || !currentRecord) return
    const updated = answerRecords.map((r) =>
      r.question_id === currentQuestion.id ? { ...r, mark_review: !r.mark_review } : r,
    )
    setAnswerRecords(updated)
    setActiveAnswerRecords(updated)
    Taro.showToast({
      title: !currentRecord.mark_review ? '已加入间隔复习清单' : '已取消标记',
      icon: 'none',
    })
  }

  const handlePrev = (e?: any) => {
    e?.stopPropagation?.()
    if (currentIndex <= 0) return
    navigateToQuestion(currentIndex - 1)
  }

  const handleNext = (e?: any) => {
    e?.stopPropagation?.()
    if (!quizData) return
    if (currentIndex < totalQuestions - 1) {
      navigateToQuestion(currentIndex + 1)
      return
    }
    setActiveQuizSession(quizData, answerRecords)
    Taro.navigateTo({
      url: `/pages/report/index?quizId=${encodeURIComponent(quizData.quiz_id)}`,
    })
  }

  if (loadingDetail) {
    return (
      <View className='quiz-empty'>
        <Text className='quiz-empty-text'>正在还原题目记录...</Text>
      </View>
    )
  }

  if (!quizData || !currentQuestion) {
    return (
      <View className='quiz-empty'>
        <Text className='quiz-empty-text'>题库尚未加载，请返回首页发起出题</Text>
        <View
          className='zx-btn-obsidian quiz-empty-btn'
          onClick={() => Taro.switchTab({ url: '/pages/index/index' })}
        >
          <Text>返回今日首页</Text>
          <Text>→</Text>
        </View>
      </View>
    )
  }

  const getOptionState = (key: string) => {
    if (!submitted) {
      return selectedAnswers.includes(key) ? 'is-selected' : ''
    }
    const isCorrectAnswer = currentQuestion.answer.includes(key)
    const isSelected = selectedAnswers.includes(key)
    if (isCorrectAnswer) return 'is-ok'
    if (isSelected && !isCorrectAnswer) return 'is-wrong'
    return ''
  }

  const diffText = DIFF_LABEL[currentQuestion.difficulty] || '自适应题'
  const sourceText = quizData.source_type
    ? SOURCE_LABEL[quizData.source_type] || '知识库生成'
    : '知识引擎生成'

  return (
    <View className='quiz-page'>
      {/* 顶部进度点阵与领域难度 */}
      <View className='quiz-top'>
        <View className='quiz-meta-row'>
          <Text className='quiz-counter'>
            {quizData.domain_name || '专题测验'} · 第 {currentIndex + 1} / {totalQuestions} 题
          </Text>
          <View className='quiz-diff-pill'>
            <Text>
              {diffText} · {isReviewReadonly ? '只读回看' : '自适应'}
            </Text>
          </View>
        </View>

        <View className='quiz-dots'>
          {questions.map((q, idx) => {
            const answered = answerRecords.some((r) => r.question_id === q.id)
            const isCurr = idx === currentIndex
            return (
              <View
                key={q.id}
                className={`qdot ${isCurr ? 'is-curr' : answered ? 'is-done' : ''}`}
                onClick={() => {
                  if (answered || idx === currentIndex) {
                    navigateToQuestion(idx)
                  }
                }}
              />
            )
          })}
        </View>
      </View>

      {/* 纯净题干区 */}
      <View className='quiz-body'>
        <Text className='quiz-kp'>考点 · {currentQuestion.knowledge_point}</Text>
        <Text className='quiz-stem'>{currentQuestion.stem}</Text>

        {currentQuestion.image_url ? (
          <View className='quiz-illustration'>
            <Image className='quiz-image' src={currentQuestion.image_url} mode='aspectFit' />
          </View>
        ) : quizData.image_status === 'generating' ? (
          <View className='quiz-image-pending'>
            <Text className='quiz-image-pending-text'>配图正在后台绘制中，可直接先行作答</Text>
          </View>
        ) : null}

        {quizData.image_notice && (
          <View className='quiz-image-notice'>
            <Text className='quiz-image-notice-text'>{quizData.image_notice}</Text>
          </View>
        )}

        {/* 选项列表 */}
        <View className='options-list'>
          {currentQuestion.options.map((opt) => {
            const optState = getOptionState(opt.key)
            const isAnswer = currentQuestion.answer.includes(opt.key)
            const isSelected = selectedAnswers.includes(opt.key)

            return (
              <View
                key={opt.key}
                className={`opt-card ${optState} ${submitted ? 'is-locked' : 'zx-press'}`}
                onClick={() => handleOptionClick(opt.key)}
              >
                <View className='opt-left'>
                  <Text className='opt-key'>{opt.key}.</Text>
                  <Text className='opt-text'>{opt.text}</Text>
                </View>

                <View className='opt-right'>
                  {submitted && isAnswer && <Text className='opt-mark is-ok'>✓</Text>}
                  {submitted && isSelected && !isAnswer && <Text className='opt-mark is-wrong'>✕</Text>}
                  {!submitted && (
                    <View className={`opt-circle ${isSelected ? 'is-selected' : ''}`} />
                  )}
                </View>
              </View>
            )
          })}
        </View>

        {/* 220ms 缓冲后平滑展开的解析卡片 */}
        {submitted && explainVisible && (
          <View className='explain-box'>
            <View className='explain-head'>
              <Text className='explain-title'>
                {isReviewReadonly ? '解析（已作答只读锁定）' : '详细解析'}
              </Text>
              <Text className='explain-source'>{sourceText}</Text>
            </View>
            <Text className='explain-body'>{currentQuestion.explanation}</Text>
            {currentRecord?.is_correct && (
              <View className='explain-actions'>
                <View className='mark-review-pill zx-press' onClick={handleToggleMarkReview}>
                  <Text>
                    {currentRecord.mark_review ? '✓ 已标记待巩固（再练）' : '+ 蒙对？加入错题复习'}
                  </Text>
                </View>
              </View>
            )}
          </View>
        )}
      </View>

      {/* 底部双栏底座：220rpx (110px) 「‹ 上一题」 + 1fr 主按钮 */}
      <View className='quiz-footer'>
        <View className='dual-nav'>
          <View
            key='quiz-prev-btn'
            className={`btn-prev ${currentIndex <= 0 ? 'is-disabled' : 'zx-press'}`}
            onClick={handlePrev}
          >
            <Text>‹ 上一题</Text>
          </View>
          {!submitted ? (
            <View
              key='quiz-submit-btn'
              className={`zx-btn-obsidian ${selectedAnswers.length === 0 ? 'is-disabled' : ''}`}
              onClick={handleSubmit}
            >
              <Text>提交答案</Text>
              <Text>✓</Text>
            </View>
          ) : (
            <View
              key='quiz-next-btn'
              className='zx-btn-obsidian'
              onClick={handleNext}
            >
              <Text>{currentIndex + 1 < totalQuestions ? '下一题' : '查看复盘报告'}</Text>
              <Text>→</Text>
            </View>
          )}
        </View>
      </View>
    </View>
  )
}
