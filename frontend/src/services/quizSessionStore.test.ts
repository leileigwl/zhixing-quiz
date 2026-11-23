import { describe, expect, it, vi } from 'vitest'
import Taro from '@tarojs/taro'
import type { AnswerRecord, QuizData } from './api'

type Store = typeof import('./quizSessionStore')

async function load(): Promise<Store> {
  vi.resetModules()
  return import('./quizSessionStore')
}

const makeQuiz = (id: string, extra: Partial<QuizData> = {}): QuizData =>
  ({
    quiz_id: id,
    title: 't',
    summary: '',
    questions: [
      { id: 'q1', type: 'single', stem: 's1', options: [], answer: ['A'], explanation: '', knowledge_point: 'k', difficulty: 'easy' },
      { id: 'q2', type: 'single', stem: 's2', options: [], answer: ['B'], explanation: '', knowledge_point: 'k', difficulty: 'easy', image_url: 'old.png' },
    ],
    ...extra,
  }) as unknown as QuizData

const ans = (qid: string, ok = true): AnswerRecord =>
  ({ question_id: qid, selected_answers: ['A'], is_correct: ok, duration_ms: 1000 }) as unknown as AnswerRecord

describe('quizSessionStore', () => {
  it('set/get：内存命中，按 expectedQuizId 过滤', async () => {
    const s = await load()
    s.setActiveQuizSession(makeQuiz('quiz_1'), [ans('q1')])
    expect(s.getActiveQuizSession().quizData?.quiz_id).toBe('quiz_1')
    expect(s.getActiveQuizSession('quiz_1').answerRecords).toHaveLength(1)
    expect(s.getActiveQuizSession('quiz_other')).toEqual({ quizData: null, answerRecords: [] })
  })

  it('内存丢失（页面冷启动 / 模块重载）时从本地存储恢复', async () => {
    const first = await load()
    first.setActiveQuizSession(makeQuiz('quiz_2'), [ans('q1'), ans('q2', false)])
    const second = await load()
    const restored = second.getActiveQuizSession('quiz_2')
    expect(restored.quizData?.quiz_id).toBe('quiz_2')
    expect(restored.answerRecords.map((a) => a.question_id)).toEqual(['q1', 'q2'])
  })

  it('作答过程写入草稿，重新打开同一测验时自动续答', async () => {
    const s = await load()
    s.setActiveQuizSession(makeQuiz('quiz_3'))
    s.setActiveAnswerRecords([ans('q1')])
    expect(s.getSavedDraftForQuiz('quiz_3')).toHaveLength(1)

    s.clearActiveQuizSession()
    s.setActiveQuizSession(makeQuiz('quiz_3'))
    expect(s.getActiveQuizSession('quiz_3').answerRecords.map((a) => a.question_id)).toEqual(['q1'])

    s.clearSavedDraftForQuiz('quiz_3')
    expect(s.getSavedDraftForQuiz('quiz_3')).toEqual([])
  })

  it('秒开复习（revq_ 前缀）不落草稿', async () => {
    const s = await load()
    s.setActiveQuizSession(makeQuiz('revq_123'))
    s.setActiveAnswerRecords([ans('q1')])
    expect(s.getSavedDraftForQuiz('revq_123')).toEqual([])
    expect(Taro.getStorageSync('zx_draft_revq_123')).toBe('')
  })

  it('显式传入 answers 时优先于草稿', async () => {
    const s = await load()
    Taro.setStorageSync('zx_draft_quiz_4', [ans('q1')])
    s.setActiveQuizSession(makeQuiz('quiz_4'), [ans('q2')])
    expect(s.getActiveQuizSession().answerRecords.map((a) => a.question_id)).toEqual(['q2'])
  })

  it('updateActiveQuizImages 只替换有新地址的题目并合并状态', async () => {
    const s = await load()
    s.setActiveQuizSession(makeQuiz('quiz_5', { image_status: 'generating' } as any))
    const updated = s.updateActiveQuizImages('quiz_5', {
      image_status: 'completed',
      image_urls: { q1: 'new1.png', q2: 'old.png' },
      image_notice: null,
    })
    expect(updated?.questions[0].image_url).toBe('new1.png')
    expect(updated?.questions[1].image_url).toBe('old.png')
    expect(updated?.image_status).toBe('completed')
    expect(updated?.image_notice).toBeNull()
    expect(s.updateActiveQuizImages('quiz_missing', {})).toBeNull()
  })

  it('存储写入抛错时仍保留内存副本', async () => {
    const s = await load()
    vi.mocked(Taro.setStorageSync).mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    expect(() => s.setActiveQuizSession(makeQuiz('quiz_6'))).not.toThrow()
    expect(s.getActiveQuizSession('quiz_6').quizData?.quiz_id).toBe('quiz_6')
  })

  it('clearActiveQuizSession 清空内存与存储', async () => {
    const s = await load()
    s.setActiveQuizSession(makeQuiz('quiz_7'), [ans('q1')])
    s.clearActiveQuizSession()
    expect(s.getActiveQuizSession()).toEqual({ quizData: null, answerRecords: [] })
  })
})
