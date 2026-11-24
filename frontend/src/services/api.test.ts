import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Taro from '@tarojs/taro'
import { __setCurrentPages } from '../../test/mocks/taro'

type ApiModule = typeof import('./api')

const ok = <T>(data: T) => ({ statusCode: 200, data: { code: 0, message: 'ok', data } })

/** api.ts 有模块级登录状态（单飞 Promise / 冷却时间），每个用例重新加载一份干净模块 */
async function loadApi(): Promise<ApiModule> {
  vi.resetModules()
  return import('./api')
}

const requestMock = () => vi.mocked(Taro.request)

describe('api.request', () => {
  const originalNodeEnv = process.env.NODE_ENV

  beforeEach(() => {
    Taro.setStorageSync('zx_token', 'tok-1')
  })

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv
  })

  it('带上 BASE_URL 与 Bearer token，code=0 时返回 data', async () => {
    const api = await loadApi()
    requestMock().mockResolvedValueOnce(ok({ hello: 'world' }) as any)

    await expect(api.request('/ping')).resolves.toEqual({ hello: 'world' })

    const call = requestMock().mock.calls[0][0] as any
    expect(call.url).toBe('https://api.test/api/v1/ping')
    expect(call.method).toBe('GET')
    expect(call.header.Authorization).toBe('Bearer tok-1')
  })

  it('业务 code != 0 时抛出后端 message', async () => {
    const api = await loadApi()
    requestMock().mockResolvedValueOnce({ statusCode: 200, data: { code: 4001, message: '题量超限', data: null } } as any)
    await expect(api.request('/quiz')).rejects.toThrow('题量超限')
  })

  it('空响应体时抛出通用错误', async () => {
    const api = await loadApi()
    requestMock().mockResolvedValueOnce({ statusCode: 500, data: undefined } as any)
    await expect(api.request('/x')).rejects.toThrow('请求失败，请稍后重试')
  })

  it('HTTP 404 抛出 ENDPOINT_NOT_FOUND（供 V1/V2 平滑降级判断）', async () => {
    const api = await loadApi()
    requestMock().mockResolvedValueOnce({ statusCode: 404, data: { code: 0, data: null } } as any)
    await expect(api.request('/v2-only')).rejects.toThrow('ENDPOINT_NOT_FOUND')
  })

  it('4010 时静默重登一次并重放原请求（dev-login 路径）', async () => {
    process.env.NODE_ENV = 'development'
    const api = await loadApi()
    requestMock()
      .mockResolvedValueOnce({ statusCode: 200, data: { code: 4010, message: 'expired', data: null } } as any)
      .mockResolvedValueOnce(ok({ token: 'tok-2', user: { id: 1 } }) as any)
      .mockResolvedValueOnce(ok({ n: 42 }) as any)

    await expect(api.request('/user/profile')).resolves.toEqual({ n: 42 })

    const urls = requestMock().mock.calls.map((c) => (c[0] as any).url)
    expect(urls).toEqual([
      'https://api.test/api/v1/user/profile',
      'https://api.test/api/v1/user/dev-login',
      'https://api.test/api/v1/user/profile',
    ])
    expect((requestMock().mock.calls[2][0] as any).header.Authorization).toBe('Bearer tok-2')
    expect(api.getToken()).toBe('tok-2')
  })

  it('4010 且重登失败时清 token、H5 跳转邮箱登录页并抛出过期错误，不会无限重试', async () => {
    process.env.NODE_ENV = 'production'
    const api = await loadApi()
    requestMock().mockResolvedValue({ statusCode: 200, data: { code: 4010, message: 'expired', data: null } } as any)

    await expect(api.request('/user/profile')).rejects.toThrow('登录已过期，请重新登录')
    expect(requestMock()).toHaveBeenCalledTimes(1)
    expect(api.getToken()).toBe('')
    expect(Taro.reLaunch).toHaveBeenCalledWith({ url: '/pages/login/index' })
  })

  it('无 token 且无法静默登录（生产 H5）时跳转邮箱登录页并抛错，不发业务请求', async () => {
    Taro.removeStorageSync('zx_token')
    process.env.NODE_ENV = 'production'
    const api = await loadApi()

    await expect(api.request('/mastery/overview')).rejects.toThrow('请先登录')
    expect(requestMock()).not.toHaveBeenCalled()
    expect(Taro.reLaunch).toHaveBeenCalledTimes(1)
    expect(Taro.reLaunch).toHaveBeenCalledWith({ url: '/pages/login/index' })
  })

  it('已在登录页时不重复跳转，返回原「登录未完成」错误', async () => {
    Taro.removeStorageSync('zx_token')
    process.env.NODE_ENV = 'production'
    __setCurrentPages([{ route: 'pages/login/index' }])
    const api = await loadApi()

    await expect(api.request('/mastery/overview')).rejects.toThrow('登录未完成')
    expect(Taro.reLaunch).not.toHaveBeenCalled()
  })
})

describe('V2 降级接口', () => {
  beforeEach(() => {
    Taro.setStorageSync('zx_token', 'tok-1')
  })

  it('getMasteryOverview 失败时返回 null（由页面走兜底总览）', async () => {
    const api = await loadApi()
    requestMock().mockRejectedValueOnce(new Error('network down'))
    await expect(api.getMasteryOverview()).resolves.toBeNull()
  })

  it('getMasteryOverview 带 domain_id 查询参数', async () => {
    const api = await loadApi()
    requestMock().mockResolvedValueOnce(ok({ streak_days: 1 }) as any)
    await api.getMasteryOverview(7)
    expect((requestMock().mock.calls[0][0] as any).url).toBe('https://api.test/api/v1/mastery/overview?domain_id=7')
  })

  it('getDueReviews 拼接 limit / domain_id / include_all', async () => {
    const api = await loadApi()
    requestMock().mockResolvedValueOnce(ok({ total_due: 0, items: [] }) as any)
    await api.getDueReviews(15, { domainId: 3, includeAll: true })
    expect((requestMock().mock.calls[0][0] as any).url).toBe(
      'https://api.test/api/v1/reviews/due?limit=15&domain_id=3&include_all=true',
    )
  })

  it('markQuestionForReview 失败返回 null', async () => {
    const api = await loadApi()
    requestMock().mockResolvedValueOnce({ statusCode: 200, data: { code: 5000, message: 'x', data: null } } as any)
    await expect(api.markQuestionForReview({ quiz_id: 'q', question_id: '1' })).resolves.toBeNull()
  })
})

describe('pollQuizTask', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Taro.setStorageSync('zx_token', 'tok-1')
  })

  const task = (status: string, extra: Record<string, unknown> = {}) =>
    ok({ task_id: 't1', status, ...extra }) as any

  it('轮询到 completed 后 resolve 结果，并逐次回调进度', async () => {
    const api = await loadApi()
    const quiz = { quiz_id: 'quiz_1', questions: [] }
    requestMock()
      .mockResolvedValueOnce(task('queued'))
      .mockResolvedValueOnce(task('generating_quiz', { stage_message: 'AI 正在编排第 1/3 题' }))
      .mockResolvedValueOnce(task('completed', { result: quiz }))
    const onProgress = vi.fn()

    const p = api.pollQuizTask('t1', onProgress, 100)
    await vi.runAllTimersAsync()

    await expect(p).resolves.toEqual(quiz)
    expect(onProgress.mock.calls.map((c) => c[0])).toEqual(['queued', 'generating_quiz', 'completed'])
    expect(requestMock()).toHaveBeenCalledTimes(3)
  })

  it('failed 状态 reject 后端错误信息', async () => {
    const api = await loadApi()
    requestMock().mockResolvedValueOnce(task('failed', { error_message: 'LLM 超时' }))
    const p = api.pollQuizTask('t1')
    const assertion = expect(p).rejects.toThrow('LLM 超时')
    await vi.runAllTimersAsync()
    await assertion
  })

  it('超过最大次数后 reject 超时，且不再继续请求', async () => {
    const api = await loadApi()
    requestMock().mockResolvedValue(task('queued'))
    const p = api.pollQuizTask('t1', undefined, 10, 3)
    const assertion = expect(p).rejects.toThrow('出题超时')
    await vi.runAllTimersAsync()
    await assertion
    expect(requestMock()).toHaveBeenCalledTimes(3)
  })

  it('请求异常时 reject 并停止轮询', async () => {
    const api = await loadApi()
    requestMock().mockRejectedValueOnce(new Error('offline'))
    const p = api.pollQuizTask('t1')
    const assertion = expect(p).rejects.toThrow('offline')
    await vi.runAllTimersAsync()
    await assertion
    expect(requestMock()).toHaveBeenCalledTimes(1)
  })
})

describe('pollReportStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Taro.setStorageSync('zx_token', 'tok-1')
  })

  it('completed 时 resolve，并把每次状态推给 onUpdate', async () => {
    const api = await loadApi()
    requestMock()
      .mockResolvedValueOnce(ok({ report_status: 'generating' }) as any)
      .mockResolvedValueOnce(ok({ report_status: 'completed', accuracy: 80 }) as any)
    const onUpdate = vi.fn()
    const p = api.pollReportStatus('quiz_1', onUpdate, { intervalMs: 50 })
    await vi.runAllTimersAsync()
    await expect(p).resolves.toMatchObject({ report_status: 'completed' })
    expect(onUpdate).toHaveBeenCalledTimes(2)
  })

  it('isCancelled 后不再请求也不回调（页面卸载）', async () => {
    const api = await loadApi()
    let cancelled = false
    requestMock().mockImplementation((async () => {
      cancelled = true
      return ok({ report_status: 'generating' })
    }) as any)
    const onUpdate = vi.fn()
    void api.pollReportStatus('quiz_1', onUpdate, { intervalMs: 50, isCancelled: () => cancelled })
    await vi.runAllTimersAsync()
    expect(requestMock()).toHaveBeenCalledTimes(1)
    expect(onUpdate).not.toHaveBeenCalled()
  })
})

describe('generateQuizAsync', () => {
  beforeEach(() => {
    Taro.setStorageSync('zx_token', 'tok-1')
  })

  it('字符串重载补齐默认参数（联网默认开启、不预热）', async () => {
    const api = await loadApi()
    requestMock().mockResolvedValueOnce(ok({ task_id: 't9' }) as any)
    await expect(api.generateQuizAsync('HTTP/3', 3, 'doc_1')).resolves.toEqual({ task_id: 't9' })
    const call = requestMock().mock.calls[0][0] as any
    expect(call.method).toBe('POST')
    expect(call.data).toMatchObject({
      user_input: 'HTTP/3',
      question_count: 3,
      doc_id: 'doc_1',
      enable_web_search: true,
      allow_prewarm: false,
      adaptive_mode: false,
      difficulty: 'mixed',
    })
  })
})
