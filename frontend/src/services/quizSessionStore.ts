import Taro from '@tarojs/taro'
import type { AnswerRecord, QuizData, QuizImageStatus } from './api'

const ACTIVE_QUIZ_KEY = 'zx_active_quiz'
const ACTIVE_ANSWERS_KEY = 'zx_active_answers'
const DRAFT_PREFIX = 'zx_draft_'

let memoryQuiz: QuizData | null = null
let memoryAnswers: AnswerRecord[] = []

function saveDraftForQuiz(quizId: string, answers: AnswerRecord[]) {
  if (!quizId || quizId.startsWith('revq_')) return
  try {
    Taro.setStorageSync(`${DRAFT_PREFIX}${quizId}`, answers)
  } catch {
    // ignore storage quota errors
  }
}

export function getSavedDraftForQuiz(quizId: string): AnswerRecord[] {
  if (!quizId || quizId.startsWith('revq_')) return []
  try {
    const raw = Taro.getStorageSync(`${DRAFT_PREFIX}${quizId}`)
    return Array.isArray(raw) ? (raw as AnswerRecord[]) : []
  } catch {
    return []
  }
}

export function clearSavedDraftForQuiz(quizId: string) {
  if (!quizId) return
  try {
    Taro.removeStorageSync(`${DRAFT_PREFIX}${quizId}`)
  } catch {
    // ignore
  }
}

/** 保存当前待作答或已完成的题库，避免路由 URL 参数过长被截断 */
export function setActiveQuizSession(quizData: QuizData, answers: AnswerRecord[] = []) {
  const restoredAnswers =
    answers.length > 0 ? answers : getSavedDraftForQuiz(quizData.quiz_id)
  memoryQuiz = quizData
  memoryAnswers = restoredAnswers
  try {
    Taro.setStorageSync(ACTIVE_QUIZ_KEY, quizData)
    Taro.setStorageSync(ACTIVE_ANSWERS_KEY, restoredAnswers)
  } catch {
    // 极端存储配额受限时保留内存副本即可
  }
}

export function getActiveQuizSession(expectedQuizId?: string): {
  quizData: QuizData | null
  answerRecords: AnswerRecord[]
} {
  let quizData = memoryQuiz
  let answerRecords = memoryAnswers

  if (!quizData) {
    try {
      quizData = Taro.getStorageSync(ACTIVE_QUIZ_KEY) || null
      answerRecords = Taro.getStorageSync(ACTIVE_ANSWERS_KEY) || []
    } catch {
      quizData = null
      answerRecords = []
    }
  }

  if (expectedQuizId && quizData && quizData.quiz_id !== expectedQuizId) {
    return { quizData: null, answerRecords: [] }
  }

  return { quizData, answerRecords }
}

export function setActiveAnswerRecords(answers: AnswerRecord[]) {
  memoryAnswers = answers
  if (memoryQuiz?.quiz_id) {
    saveDraftForQuiz(memoryQuiz.quiz_id, answers)
  }
  try {
    Taro.setStorageSync(ACTIVE_ANSWERS_KEY, answers)
  } catch {
    // ignore storage errors
  }
}

export function updateActiveQuizImages(
  quizId: string,
  patch: {
    image_status?: QuizImageStatus
    image_urls?: Record<string, string>
    image_notice?: string | null
  },
): QuizData | null {
  const { quizData } = getActiveQuizSession(quizId)
  if (!quizData) {
    return null
  }
  const imageUrls = patch.image_urls ?? {}
  const updatedQuestions = quizData.questions.map((question) => {
    const nextUrl = imageUrls[question.id]
    if (!nextUrl || nextUrl === question.image_url) {
      return question
    }
    return { ...question, image_url: nextUrl }
  })
  const updatedQuiz: QuizData = {
    ...quizData,
    questions: updatedQuestions,
    image_status: patch.image_status ?? quizData.image_status,
    image_notice:
      patch.image_notice !== undefined ? patch.image_notice : quizData.image_notice,
  }
  memoryQuiz = updatedQuiz
  try {
    Taro.setStorageSync(ACTIVE_QUIZ_KEY, updatedQuiz)
  } catch {
    // ignore storage errors
  }
  return updatedQuiz
}

export function clearActiveQuizSession() {
  memoryQuiz = null
  memoryAnswers = []
  try {
    Taro.removeStorageSync(ACTIVE_QUIZ_KEY)
    Taro.removeStorageSync(ACTIVE_ANSWERS_KEY)
  } catch {
    // ignore
  }
}
