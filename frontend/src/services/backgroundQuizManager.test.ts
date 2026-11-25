import { beforeEach, describe, expect, it, vi } from 'vitest'
import Taro from '@tarojs/taro'
import { __setCurrentPages, eventCenter } from '../../test/mocks/taro'
import type { QuizData } from './api'

vi.mock('./api', () => ({
  ensureLogin: vi.fn(),
  generateQuizAsync: vi.fn(),
  pollQuizTask: vi.fn(),
}))

const BG_EVENT = 'zx:bg-quiz-update'

const quiz: QuizData = {
  quiz_id: 'quiz_42',
  title: 'HTTP/3',
  summary: '',
  questions: [{ id: 'q1' } as any, { id: 'q2' } as any],
} as QuizData

type Mgr = typeof import('./backgroundQuizManager')
type Api = typeof import('./api')

/** backgroundQuizManager 持有模块级单例状态与计时器，每个用例重新加载 */
async function load(): Promise<{ mgr: Mgr; api: Api }> {
  vi.resetModules()
  const api = await import('./api')
  const mgr = await import('./backgroundQuizManager')
  return { mgr, api }
}

/** 让挂起的 Promise 链跑完（不推进假时钟） */
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

describe('subscribeBackgroundQuiz', () => {
  it('订阅时立即推送当前快照，退订后不再收到事件', async () => {
    const { mgr } = await load()
    const cb = vi.fn()
    const unsubscribe = mgr.subscribeBackgroundQuiz(cb)
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb.mock.calls[0][0]).toMatchObject({ status: 'idle' })

    mgr.dismissBackgroundQuiz()
    expect(cb).toHaveBeenCalledTimes(2)

    unsubscribe()
    mgr.dismissBackgroundQuiz()
    expect(cb).toHaveBeenCalledTimes(2)
    expect(eventCenter.listenerCount(BG_EVENT)).toBe(0)
  })

  it('页面反复显示/隐藏（订阅-退订循环）不会累积重复监听器（d46b49c 回归）', async () => {
    const { mgr } = await load()
    const cb = vi.fn()
    for (let i = 0; i < 5; i++) {
      const off = mgr.subscribeBackgroundQuiz(cb)
      off()
    }
    const off = mgr.subscribeBackgroundQuiz(cb)
    expect(eventCenter.listenerCount(BG_EVENT)).toBe(1)

    cb.mockClear()
    mgr.dismissBackgroundQuiz()
    expect(cb).toHaveBeenCalledTimes(1)
    off()
    expect(eventCenter.listenerCount(BG_EVENT)).toBe(0)
  })

  it('多个页面各自订阅、各自退订互不影响', async () => {
    const { mgr } = await load()
    const a = vi.fn()
    const b = vi.fn()
    const offA = mgr.subscribeBackgroundQuiz(a)
    const offB = mgr.subscribeBackgroundQuiz(b)
    offA()
    a.mockClear()
    b.mockClear()
    mgr.dismissBackgroundQuiz()
    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledTimes(1)
    offB()
  })

  it('getBackgroundQuizState 返回副本，外部修改不污染内部状态', async () => {
    const { mgr } = await load()
    const snap = mgr.getBackgroundQuizState()
    snap.status = 'failed'
    expect(mgr.getBackgroundQuizState().status).toBe('idle')
  })
})

describe('startBackgroundQuizGeneration 生命周期', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-24T10:00:00+08:00'))
  })

  it('用户离开发起页：running → 计时递增 → 阶段文案更新 → completed（不自动跳转）', async () => {
    const { mgr, api } = await load()
    vi.mocked(api.ensureLogin).mockResolvedValue(true)
    vi.mocked(api.generateQuizAsync).mockResolvedValue({ task_id: 't1' })
    let resolvePoll!: (q: QuizData) => void
    vi.mocked(api.pollQuizTask).mockImplementation((_id, onProgress) => {
      onProgress?.('generating_quiz', { stage_message: 'AI 正在编排第 1/2 题' } as any)
      return new Promise((r) => {
        resolvePoll = r
      })
    })
    const states: string[] = []
    const seen = vi.fn((s) => states.push(`${s.status}:${s.stageMessage}`))
    mgr.subscribeBackgroundQuiz(seen)

    __setCurrentPages([{ route: 'pages/index/index' }])
    const run = mgr.startBackgroundQuizGeneration({
      user_input: 'HTTP/3',
      displayTopic: 'HTTP/3 与 QUIC 握手',
      originTag: 'home',
    })
    await flush()
    expect(mgr.getBackgroundQuizState()).toMatchObject({
      status: 'running',
      taskId: 't1',
      originTag: 'home',
      initiatedRoute: 'pages/index/index',
      stageMessage: 'AI 正在编排第 1/2 题',
    })

    await vi.advanceTimersByTimeAsync(3000)
    expect(mgr.getBackgroundQuizState().elapsedSec).toBe(3)

    // 用户切到口袋页
    __setCurrentPages([{ route: 'pages/knowledge/index' }])
    resolvePoll(quiz)
    await run

    const final = mgr.getBackgroundQuizState()
    expect(final.status).toBe('completed')
    expect(final.quizData?.quiz_id).toBe('quiz_42')
    expect(final.stageMessage).toBe('共 2 题已就绪')
    expect(Taro.navigateTo).not.toHaveBeenCalled()

    // 计时器已停止：再推进时间不再发事件
    seen.mockClear()
    await vi.advanceTimersByTimeAsync(5000)
    expect(seen).not.toHaveBeenCalled()
    expect(states[0]).toMatch(/^idle:/)
    expect(states.some((s) => s.startsWith('running:'))).toBe(true)
  })

  it('用户停留在发起页：完成后直接跳答题页并复位为 idle', async () => {
    const { mgr, api } = await load()
    vi.mocked(api.ensureLogin).mockResolvedValue(true)
    vi.mocked(api.generateQuizAsync).mockResolvedValue({ task_id: 't2' })
    vi.mocked(api.pollQuizTask).mockResolvedValue(quiz)
    __setCurrentPages([{ route: 'pages/index/index' }])

    await mgr.startBackgroundQuizGeneration({ user_input: 'x', displayTopic: 'x' })

    expect(Taro.navigateTo).toHaveBeenCalledWith({ url: '/pages/quiz/index?quizId=quiz_42' })
    expect(mgr.getBackgroundQuizState().status).toBe('idle')
    expect(Taro.getStorageSync('zx_active_quiz')).toMatchObject({ quiz_id: 'quiz_42' })
  })

  it('运行中重复点击不会发起第二个任务', async () => {
    const { mgr, api } = await load()
    vi.mocked(api.ensureLogin).mockResolvedValue(true)
    vi.mocked(api.generateQuizAsync).mockResolvedValue({ task_id: 't3' })
    vi.mocked(api.pollQuizTask).mockReturnValue(new Promise(() => {}))

    void mgr.startBackgroundQuizGeneration({ user_input: 'a', displayTopic: 'a' })
    await flush()
    await mgr.startBackgroundQuizGeneration({ user_input: 'b', displayTopic: 'b' })

    expect(api.generateQuizAsync).toHaveBeenCalledTimes(1)
    expect(Taro.showToast).toHaveBeenCalledWith(expect.objectContaining({ title: '上一组题正在生成中，请稍候' }))
  })

  it('登录失败 → failed，计时器停止', async () => {
    const { mgr, api } = await load()
    vi.mocked(api.ensureLogin).mockResolvedValue(false)
    const cb = vi.fn()
    mgr.subscribeBackgroundQuiz(cb)

    await mgr.startBackgroundQuizGeneration({ user_input: 'a', displayTopic: 'a' })
    expect(mgr.getBackgroundQuizState()).toMatchObject({ status: 'failed', errorMessage: '正在建立登录会话，请稍后重试' })
    expect(api.generateQuizAsync).not.toHaveBeenCalled()

    cb.mockClear()
    await vi.advanceTimersByTimeAsync(3000)
    expect(cb).not.toHaveBeenCalled()
  })

  it('轮询失败 → failed 并带上错误信息；失败后可以重新发起', async () => {
    const { mgr, api } = await load()
    vi.mocked(api.ensureLogin).mockResolvedValue(true)
    vi.mocked(api.generateQuizAsync).mockResolvedValue({ task_id: 't4' })
    vi.mocked(api.pollQuizTask).mockRejectedValueOnce(new Error('题目生成失败'))

    await mgr.startBackgroundQuizGeneration({ user_input: 'a', displayTopic: 'a' })
    expect(mgr.getBackgroundQuizState()).toMatchObject({ status: 'failed', stageMessage: '题目生成失败' })

    vi.mocked(api.pollQuizTask).mockResolvedValueOnce(quiz)
    __setCurrentPages([{ route: 'pages/profile/index' }])
    await mgr.startBackgroundQuizGeneration({ user_input: 'a', displayTopic: 'a', initiatedRoute: 'pages/index/index' })
    expect(api.generateQuizAsync).toHaveBeenCalledTimes(2)
    expect(mgr.getBackgroundQuizState().status).toBe('completed')
  })

  it('openReadyBackgroundQuiz 打开已就绪题组并复位', async () => {
    const { mgr, api } = await load()
    vi.mocked(api.ensureLogin).mockResolvedValue(true)
    vi.mocked(api.generateQuizAsync).mockResolvedValue({ task_id: 't5' })
    vi.mocked(api.pollQuizTask).mockResolvedValue(quiz)
    __setCurrentPages([{ route: 'pages/mastery/index' }])
    await mgr.startBackgroundQuizGeneration({ user_input: 'a', displayTopic: 'a', initiatedRoute: 'pages/index/index' })
    expect(mgr.getBackgroundQuizState().status).toBe('completed')

    mgr.openReadyBackgroundQuiz()
    expect(Taro.navigateTo).toHaveBeenCalledWith({ url: '/pages/quiz/index?quizId=quiz_42' })
    expect(mgr.getBackgroundQuizState().status).toBe('idle')
  })

  it('openReadyBackgroundQuiz 在没有就绪题组时什么也不做', async () => {
    const { mgr } = await load()
    mgr.openReadyBackgroundQuiz()
    expect(Taro.navigateTo).not.toHaveBeenCalled()
  })
})
