import Taro from '@tarojs/taro'
import type { AnswerRecord, QuizData } from './api'

const ACTIVE_QUIZ_KEY = 'zx_active_quiz'
const ACTIVE_ANSWERS_KEY = 'zx_active_answers'

let memoryQuiz: QuizData | null = null
let memoryAnswers: AnswerRecord[] = []

/** 保存当前待作答或已完成的题库，避免路由 URL 参数过长被截断 */
export function setActiveQuizSession(quizData: QuizData, answers: AnswerRecord[] = []) {
  memoryQuiz = quizData
  memoryAnswers = answers
  try {
    Taro.setStorageSync(ACTIVE_QUIZ_KEY, quizData)
    Taro.setStorageSync(ACTIVE_ANSWERS_KEY, answers)
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
  try {
    Taro.setStorageSync(ACTIVE_ANSWERS_KEY, answers)
  } catch {
    // ignore storage errors
  }
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
