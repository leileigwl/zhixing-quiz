import Taro from '@tarojs/taro'
import {
  ensureLogin,
  generateQuizAsync,
  pollQuizTask,
  type GenerateQuizAsyncParams,
  type QuizData,
} from './api'
import { setActiveQuizSession } from './quizSessionStore'
import { invalidateSwrCache } from './v2Adapters'

export type BgQuizStatus = 'idle' | 'running' | 'completed' | 'failed'

export interface BackgroundQuizState {
  status: BgQuizStatus
  taskId?: string
  topic: string
  originTag?: string
  stageMessage: string
  startedAt: number
  elapsedSec: number
  initiatedRoute: string
  quizData?: QuizData
  errorMessage?: string
}

const BG_EVENT = 'zx:bg-quiz-update'

let currentState: BackgroundQuizState = {
  status: 'idle',
  topic: '',
  stageMessage: '',
  startedAt: 0,
  elapsedSec: 0,
  initiatedRoute: 'index',
}

let activeTimer: ReturnType<typeof setInterval> | null = null

function emitState() {
  Taro.eventCenter.trigger(BG_EVENT, { ...currentState })
}

function stopElapsedTicker() {
  if (activeTimer) {
    clearInterval(activeTimer)
    activeTimer = null
  }
}

function getTopPageRoute(): string {
  try {
    const pages = Taro.getCurrentPages()
    const last = pages[pages.length - 1]
    return String((last as any)?.route || '')
  } catch {
    return ''
  }
}

export function getBackgroundQuizState(): BackgroundQuizState {
  return { ...currentState }
}

export function subscribeBackgroundQuiz(cb: (state: BackgroundQuizState) => void): () => void {
  const handler = (next: BackgroundQuizState) => cb(next)
  Taro.eventCenter.on(BG_EVENT, handler)
  cb(getBackgroundQuizState())
  return () => {
    Taro.eventCenter.off(BG_EVENT, handler)
  }
}

export function dismissBackgroundQuiz() {
  stopElapsedTicker()
  currentState = {
    status: 'idle',
    topic: '',
    stageMessage: '',
    startedAt: 0,
    elapsedSec: 0,
    initiatedRoute: 'index',
  }
  emitState()
}

export function openReadyBackgroundQuiz() {
  const q = currentState.quizData
  if (!q) return
  setActiveQuizSession(q, [])
  dismissBackgroundQuiz()
  Taro.navigateTo({
    url: `/pages/quiz/index?quizId=${encodeURIComponent(q.quiz_id)}`,
  })
}

export async function startBackgroundQuizGeneration(
  params: GenerateQuizAsyncParams & {
    displayTopic: string
    initiatedRoute?: string
    originTag?: string
  },
): Promise<void> {
  if (currentState.status === 'running') {
    Taro.showToast({ title: '上一组题正在生成中，请稍候', icon: 'none' })
    return
  }

  const originRoute = params.initiatedRoute || getTopPageRoute() || 'pages/index/index'
  stopElapsedTicker()
  currentState = {
    status: 'running',
    topic: params.displayTopic.slice(0, 16),
    originTag: params.originTag,
    stageMessage: '正在调度并行检索与出题...',
    startedAt: Date.now(),
    elapsedSec: 0,
    initiatedRoute: originRoute,
  }
  emitState()

  activeTimer = setInterval(() => {
    if (currentState.status !== 'running') {
      stopElapsedTicker()
      return
    }
    currentState = {
      ...currentState,
      elapsedSec: Math.max(1, Math.floor((Date.now() - currentState.startedAt) / 1000)),
    }
    emitState()
  }, 1000)

  try {
    const authed = await ensureLogin()
    if (!authed) {
      throw new Error('正在建立登录会话，请稍后重试')
    }

    const { task_id } = await generateQuizAsync(params)
    currentState = {
      ...currentState,
      taskId: task_id,
      stageMessage: params.enable_web_search
        ? '并行检索资料与实时联网中...'
        : 'AI 正在精准编排题目...',
    }
    emitState()

    const quizData = await pollQuizTask(task_id, (_status, task) => {
      if (currentState.status !== 'running') return
      if (task?.stage_message) {
        currentState = { ...currentState, stageMessage: task.stage_message }
        emitState()
      }
    })

    stopElapsedTicker()
    invalidateSwrCache('home_')
    setActiveQuizSession(quizData, [])

    const topRoute = getTopPageRoute()
    const stayedOnOrigin =
      Boolean(topRoute) &&
      (topRoute === originRoute ||
        (originRoute.includes('index') && topRoute.includes('pages/index')))

    if (stayedOnOrigin) {
      dismissBackgroundQuiz()
      if (quizData.image_notice) {
        Taro.showToast({ title: quizData.image_notice, icon: 'none', duration: 2400 })
      }
      Taro.navigateTo({
        url: `/pages/quiz/index?quizId=${encodeURIComponent(quizData.quiz_id)}`,
      })
      return
    }

    currentState = {
      ...currentState,
      status: 'completed',
      stageMessage: `共 ${quizData.questions.length} 题已就绪`,
      quizData,
    }
    emitState()
  } catch (err: any) {
    stopElapsedTicker()
    currentState = {
      ...currentState,
      status: 'failed',
      stageMessage: err?.message || '组卷失败，请稍后重试',
      errorMessage: err?.message || '组卷失败，请稍后重试',
    }
    emitState()
  }
}
