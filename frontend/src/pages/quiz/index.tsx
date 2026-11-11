import { useState, useMemo, useEffect } from 'react'
import { View, Text, Image } from '@tarojs/components'
import Taro, { useRouter } from '@tarojs/taro'
import { getQuizDetail } from '../../services/api'
import type { Question, AnswerRecord, QuizData } from '../../services/api'
import { getActiveQuizSession, setActiveAnswerRecords, setActiveQuizSession } from '../../services/quizSessionStore'
import './index.scss'

const TYPE_LABEL: Record<Question['type'], string> = {
  single: '单选题',
  multiple: '多选题',
  judge: '判断题',
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
          }
          setQuizData(restored)
          setActiveQuizSession(restored, detail.answer_records || [])
        })
        .catch(() => {})
        .finally(() => setLoadingDetail(false))
    }
  }, [quizData, paramQuizId])

  useEffect(() => {
    if (quizData?.title) {
      Taro.setNavigationBarTitle({ title: quizData.title.slice(0, 10) })
    }
  }, [quizData?.title])

  const questions = quizData?.questions || []
  const totalQuestions = questions.length

  const [currentIndex, setCurrentIndex] = useState(0)
  const [selectedAnswers, setSelectedAnswers] = useState<string[]>([])
  const [submitted, setSubmitted] = useState(false)
  const [explainOpen, setExplainOpen] = useState(true)
  const [answerRecords, setAnswerRecords] = useState<AnswerRecord[]>([])
  const [startTime, setStartTime] = useState<number>(Date.now())

  const currentQuestion: Question | undefined = questions[currentIndex]

  const handleOptionClick = (key: string) => {
    if (submitted || !currentQuestion) return

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

    const duration = Date.now() - startTime
    const record: AnswerRecord = {
      question_id: currentQuestion.id,
      selected_answers: [...selectedAnswers],
      is_correct: isCorrect,
      duration_ms: duration,
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
    setExplainOpen(true)
  }

  const handleNext = () => {
    if (!quizData) return

    if (currentIndex < totalQuestions - 1) {
      const nextIdx = currentIndex + 1
      const nextQuestionObj = questions[nextIdx]
      const existingNext = answerRecords.find((r) => r.question_id === nextQuestionObj?.id)

      setCurrentIndex(nextIdx)
      if (existingNext) {
        setSelectedAnswers(existingNext.selected_answers)
        setSubmitted(true)
      } else {
        setSelectedAnswers([])
        setSubmitted(false)
        setStartTime(Date.now())
      }
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
        <Text className='quiz-empty-text'>正在加载题库...</Text>
      </View>
    )
  }

  if (!quizData || !currentQuestion) {
    return (
      <View className='quiz-empty'>
        <Text className='quiz-empty-text'>题库数据未加载，请返回重新出题</Text>
        <View
          className='zx-btn-primary quiz-empty-btn'
          onClick={() => Taro.switchTab({ url: '/pages/index/index' })}
        >
          <Text>返回首页</Text>
        </View>
      </View>
    )
  }

  const progressPercent = Math.round(((currentIndex + 1) / totalQuestions) * 100)

  const getOptionState = (key: string) => {
    if (!submitted) {
      return selectedAnswers.includes(key) ? 'is-selected' : ''
    }
    const isCorrectAnswer = currentQuestion.answer.includes(key)
    const isSelected = selectedAnswers.includes(key)
    if (isCorrectAnswer) return 'is-correct'
    if (isSelected && !isCorrectAnswer) return 'is-wrong'
    return ''
  }

  return (
    <View className='quiz-page'>
      <View className='quiz-top-meta'>
        <Text className='quiz-step-label'>答题进度</Text>
        <Text className='quiz-step-num'>
          {currentIndex + 1} / {totalQuestions}
        </Text>
      </View>

      <View className='quiz-progress-track'>
        <View className='quiz-progress-fill' style={{ width: `${progressPercent}%` }} />
      </View>

      <View className='quiz-tags'>
        <View className='tag-outline'>
          <Text>{TYPE_LABEL[currentQuestion.type] || '选择题'}</Text>
        </View>
        <View className='tag-soft'>
          <Text>知识点：{currentQuestion.knowledge_point}</Text>
        </View>
      </View>

      <Text className='quiz-stem'>{currentQuestion.stem}</Text>

      {currentQuestion.image_url && (
        <View className='quiz-illustration'>
          <Image className='quiz-image' src={currentQuestion.image_url} mode='aspectFit' />
        </View>
      )}

      <View className='options-list'>
        {currentQuestion.options.map((opt) => {
          const optState = getOptionState(opt.key)
          const isAnswer = currentQuestion.answer.includes(opt.key)
          const isSelected = selectedAnswers.includes(opt.key)

          return (
            <View
              key={opt.key}
              className={`option-card ${optState}`}
              onClick={() => handleOptionClick(opt.key)}
            >
              <View className='option-left'>
                <View className='option-key'>
                  <Text>{opt.key}</Text>
                </View>
                <Text className='option-text'>{opt.text}</Text>
              </View>
              {submitted && isAnswer && (
                <Text className='option-status is-correct'>✓ 正确答案</Text>
              )}
              {submitted && isSelected && !isAnswer && (
                <Text className='option-status is-wrong'>✕ 你的选择</Text>
              )}
            </View>
          )
        })}
      </View>

      {submitted && (
        <View className='explain-card'>
          <View className='explain-head' onClick={() => setExplainOpen((prev) => !prev)}>
            <Text className='explain-title'>详细解析</Text>
            <Text className='explain-chevron'>{explainOpen ? '⌄' : '›'}</Text>
          </View>
          {explainOpen && (
            <View className='explain-body'>
              <Text className='explain-content'>{currentQuestion.explanation}</Text>
            </View>
          )}
        </View>
      )}

      <View className='sticky-footer'>
        {!submitted ? (
          <View
            className={`zx-btn-primary ${selectedAnswers.length === 0 ? 'is-disabled' : ''}`}
            onClick={handleSubmit}
          >
            <Text>提交答案</Text>
          </View>
        ) : (
          <View className='zx-btn-primary' onClick={handleNext}>
            <Text>{currentIndex + 1 < totalQuestions ? '下一题' : '查看复盘报告'}</Text>
          </View>
        )}
      </View>
    </View>
  )
}
