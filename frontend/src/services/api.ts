import Taro from '@tarojs/taro'

// 由 config/dev.ts、config/prod.ts 中的 defineConstants 注入
declare const API_BASE_URL: string

const BASE_URL = API_BASE_URL
const TOKEN_KEY = 'zx_token'
const USER_KEY = 'zx_user_info'
const LOGIN_EMAIL_KEY = 'zx_login_email'

let _loginResolve: (() => void) | null = null
const _loginReady = new Promise<void>((resolve) => {
  _loginResolve = resolve
})
let _inflightLogin: Promise<boolean> | null = null
let _lastLoginFailAt = 0
const LOGIN_FAIL_COOLDOWN_MS = 3000

export function waitForLogin(): Promise<void> {
  return _loginReady
}

export function resolveLogin() {
  if (_loginResolve) {
    _loginResolve()
    _loginResolve = null
  }
}

interface ApiResponse<T = any> {
  code: number
  message: string
  data: T
}

export function getToken(): string {
  return Taro.getStorageSync(TOKEN_KEY) || ''
}

export function setToken(token: string) {
  Taro.setStorageSync(TOKEN_KEY, token)
}

export function clearToken() {
  Taro.removeStorageSync(TOKEN_KEY)
  Taro.removeStorageSync(USER_KEY)
}

export function getCachedUser(): UserBrief | null {
  const raw = Taro.getStorageSync(USER_KEY)
  return raw || null
}

export function setCachedUser(user: UserBrief) {
  Taro.setStorageSync(USER_KEY, user)
}

/** H5 邮箱登录时记录的登录邮箱（只存本机，用于侧栏 / 「我的」账号区展示） */
export function getLoginEmail(): string {
  const raw = Taro.getStorageSync(LOGIN_EMAIL_KEY)
  return typeof raw === 'string' ? raw : ''
}

/** 通用底层请求（不自动处理 4010 重试，供登录接口本身调用） */
async function rawRequest<T = any>(
  url: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
    data?: any
    timeout?: number
    withAuth?: boolean
  } = {},
): Promise<{ statusCode: number; body: ApiResponse<T> }> {
  const { method = 'GET', data, timeout = 120000, withAuth = true } = options
  const header: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (withAuth) {
    const token = getToken()
    if (token) {
      header['Authorization'] = `Bearer ${token}`
    }
  }

  const res = await Taro.request({
    url: `${BASE_URL}${url}`,
    method,
    data,
    header,
    timeout,
  })

  return {
    statusCode: res.statusCode,
    body: res.data as ApiResponse<T>,
  }
}

/**
 * 单飞静默登录（支持微信小程序 wx.login 与非生产 H5 dev-login 自动衔接）。
 * forceRefresh=true 时忽略已有本地 token 重新换取新 JWT。
 */
export async function ensureLogin(forceRefresh = false): Promise<boolean> {
  if (!forceRefresh && getToken()) {
    resolveLogin()
    return true
  }

  if (!forceRefresh && _lastLoginFailAt > 0 && Date.now() - _lastLoginFailAt < LOGIN_FAIL_COOLDOWN_MS) {
    resolveLogin()
    return false
  }

  if (_inflightLogin) {
    return _inflightLogin
  }

  _inflightLogin = (async () => {
    try {
      if (forceRefresh) {
        clearToken()
      }

      if (process.env.TARO_ENV === 'weapp') {
        const loginRes = await new Promise<Taro.login.SuccessCallbackResult>((resolve, reject) => {
          Taro.login({ success: resolve, fail: reject })
        })
        if (!loginRes.code) {
          _lastLoginFailAt = Date.now()
          return false
        }
        const { body } = await rawRequest<LoginResponse>('/user/login', {
          method: 'POST',
          data: { code: loginRes.code },
          withAuth: false,
        })
        if (body?.code === 0 && body.data?.token) {
          _lastLoginFailAt = 0
          setToken(body.data.token)
          setCachedUser(body.data.user)
          return true
        }
        _lastLoginFailAt = Date.now()
        return false
      }

      if (process.env.NODE_ENV === 'development') {
        const { body } = await rawRequest<LoginResponse>('/user/dev-login', {
          method: 'POST',
          data: { dev_id: 'h5_preview', nickname: '高同学' },
          withAuth: false,
        })
        if (body?.code === 0 && body.data?.token) {
          _lastLoginFailAt = 0
          setToken(body.data.token)
          setCachedUser(body.data.user)
          return true
        }
      }

      _lastLoginFailAt = Date.now()
      return false
    } catch {
      _lastLoginFailAt = Date.now()
      return false
    } finally {
      _inflightLogin = null
      resolveLogin()
    }
  })()

  return _inflightLogin
}

/* ---- H5 邮箱验证码登录（生产 H5 唯一登录通道；weapp 仍走 wx.login） ---- */

export const LOGIN_PAGE_URL = '/pages/login/index'
export const HOME_PAGE_URL = '/pages/index/index'
const LOGIN_PAGE_ROUTE = 'pages/login/index'
const REDIRECT_DEDUPE_MS = 1500
let _lastRedirectAt = 0

/** 当前端是否使用邮箱登录页（仅 H5；小程序保持 wx.login 静默登录） */
export function usesEmailLoginPage(): boolean {
  return process.env.TARO_ENV === 'h5'
}

const LANDING_PAGE_ROUTE = 'pages/landing/index'

function currentRoute(): string {
  try {
    const pages = Taro.getCurrentPages()
    const current = pages[pages.length - 1] as { route?: string } | undefined
    return (current?.route || '').replace(/^\//, '')
  } catch {
    return ''
  }
}

/** 当前是否在公开页（登录页 / V3.0 门头页），公开页上不因「未登录」跳走 */
function isOnPublicPage(): boolean {
  const route = currentRoute()
  if (route.startsWith(LOGIN_PAGE_ROUTE) || route.startsWith(LANDING_PAGE_ROUTE)) return true
  // 启动瞬间 getCurrentPages 可能还为空：H5 退回读 hash
  if (!route && process.env.TARO_ENV === 'h5' && typeof window !== 'undefined') {
    return /pages\/(login|landing)\/index/.test(window.location.hash || '')
  }
  return false
}

/** H5 无有效登录态时跳转登录页（去重：并发请求同时 401 只跳一次；已在登录页 / 门头页时不跳） */
export function redirectToLogin(): boolean {
  if (!usesEmailLoginPage() || isOnPublicPage()) return false
  const now = Date.now()
  if (now - _lastRedirectAt < REDIRECT_DEDUPE_MS) return false
  _lastRedirectAt = now
  void Promise.resolve(Taro.reLaunch({ url: LOGIN_PAGE_URL })).catch(() => undefined)
  return true
}

/** 携带后端业务码的认证错误，供登录页 mapAuthError 映射界面状态 */
export class AuthApiError extends Error {
  code?: number
  statusCode?: number

  constructor(message: string, code?: number, statusCode?: number) {
    super(message)
    this.name = 'AuthApiError'
    this.code = code
    this.statusCode = statusCode
  }
}

export interface SendEmailCodeResult {
  message: string
  cooldown_seconds: number
  expires_in_seconds: number
}

async function authRequest<T>(url: string, data: Record<string, unknown>): Promise<T> {
  let res: { statusCode: number; body: ApiResponse<T> }
  try {
    res = await rawRequest<T>(url, { method: 'POST', data, withAuth: false, timeout: 20000 })
  } catch {
    throw new AuthApiError('网络连接失败，请检查网络后重试')
  }
  const { statusCode, body } = res
  if (body && typeof body.code === 'number') {
    if (body.code === 0) return body.data
    throw new AuthApiError(body.message || '请求失败，请稍后重试', body.code, statusCode)
  }
  // 非 ApiResponse 结构（如 422 参数校验、网关 502）
  throw new AuthApiError('请求失败，请稍后重试', statusCode >= 500 ? 5000 : 4000, statusCode)
}

export function sendEmailCode(email: string) {
  return authRequest<SendEmailCodeResult>('/auth/email/send-code', { email: email.trim().toLowerCase() })
}

/** 校验验证码；成功后与 wx.login 一致地保存 token 与用户信息并解除登录等待 */
export async function verifyEmailCode(email: string, code: string): Promise<LoginResponse> {
  const data = await authRequest<LoginResponse>('/auth/email/verify', {
    email: email.trim().toLowerCase(),
    code,
  })
  if (!data?.token) {
    throw new AuthApiError('登录失败，请稍后重试')
  }
  setToken(data.token)
  setCachedUser(data.user)
  Taro.setStorageSync(LOGIN_EMAIL_KEY, email.trim().toLowerCase())
  _lastLoginFailAt = 0
  resolveLogin()
  return data
}

/**
 * 退出登录（H5「我的」页）：清掉本机 token / 用户缓存 / 登录邮箱，回到登录页。
 * JWT 无服务端会话，清本地即失效于本机；weapp 无退出入口。
 */
export function logout() {
  clearToken()
  Taro.removeStorageSync(LOGIN_EMAIL_KEY)
  _lastRedirectAt = 0
  void Promise.resolve(Taro.reLaunch({ url: LOGIN_PAGE_URL })).catch(() => undefined)
}

async function ensureAuthToken(): Promise<string> {
  if (!getToken()) {
    const loggedIn = await ensureLogin()
    if (!loggedIn || !getToken()) {
      if (redirectToLogin()) {
        throw new Error('请先登录')
      }
      throw new Error('登录未完成，请确认后端服务与接口地址配置正确')
    }
  }
  return getToken()
}

/** 带 4010 自动静默重登重试一次的核心请求封装 */
export async function request<T = any>(
  url: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
    data?: any
    timeout?: number
  } = {},
  _retried = false,
): Promise<T> {
  await ensureAuthToken()
  const { statusCode, body } = await rawRequest<T>(url, options)

  if (body?.code === 4010) {
    if (!_retried) {
      const ok = await ensureLogin(true)
      if (ok) {
        return request<T>(url, options, true)
      }
    }
    clearToken()
    if (redirectToLogin()) {
      throw new Error('登录已过期，请重新登录')
    }
    throw new Error('登录状态已过期，请刷新或重新进入')
  }

  if (statusCode === 404) {
    throw new Error('ENDPOINT_NOT_FOUND')
  }

  if (!body || body.code !== 0) {
    throw new Error(body?.message || '请求失败，请稍后重试')
  }

  return body.data
}

/* ---- 出题与任务轮询 API（V2 支持自适应题量、冷启动自评、显式联网开关与领域 ID） ---- */

export type SelfRatedLevel = 'unfamiliar' | 'familiar' | 'mastered'
export type QuestionCountChoice = 'adaptive' | 3 | 5 | 10 | 15
export type QuizSourceType = 'llm_direct' | 'kb_rag' | 'web_search'

export interface GenerateQuizAsyncParams {
  user_input: string
  reference_text?: string
  question_count?: number
  adaptive_mode?: boolean
  self_rated_level?: SelfRatedLevel
  doc_id?: string
  doc_ids?: string[]
  domain_id?: number
  enable_web_search?: boolean
  generate_images?: boolean
  review_card_ids?: number[]
  allow_prewarm?: boolean
}

export function generateQuizAsync(
  paramsOrInput: string | GenerateQuizAsyncParams,
  questionCount = 5,
  docId?: string,
  generateImages = false,
) {
  const payload: GenerateQuizAsyncParams =
    typeof paramsOrInput === 'string'
      ? {
          user_input: paramsOrInput,
          question_count: questionCount,
          doc_id: docId,
          generate_images: generateImages,
        }
      : paramsOrInput

  return request<{ task_id: string }>('/quiz/generate/async', {
    method: 'POST',
    data: {
      user_input: payload.user_input,
      reference_text: payload.reference_text,
      question_count: payload.question_count ?? 5,
      adaptive_mode: payload.adaptive_mode ?? false,
      self_rated_level: payload.self_rated_level,
      difficulty: 'mixed',
      doc_id: payload.doc_id,
      doc_ids: payload.doc_ids,
      domain_id: payload.domain_id,
      enable_web_search: payload.enable_web_search ?? true,
      generate_images: payload.generate_images ?? false,
      review_card_ids: payload.review_card_ids,
      allow_prewarm: payload.allow_prewarm ?? false,
    },
  })
}

export function getQuizTaskStatus(taskId: string) {
  return request<QuizTaskStatus>(`/quiz/task/${taskId}`)
}

/** 阶梯高频轮询异步出题任务状态（前 8 次 700ms，随后 1100ms，明显降低感知延迟） */
export function pollQuizTask(
  taskId: string,
  onProgress?: (status: string, task: QuizTaskStatus) => void,
  initialIntervalMs = 500,
  maxAttempts = 150,
): Promise<QuizData> {
  return new Promise((resolve, reject) => {
    let attempts = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    let settled = false

    const tick = async () => {
      if (settled) return
      attempts++
      try {
        const res = await getQuizTaskStatus(taskId)
        onProgress?.(res.status, res)

        if (res.status === 'completed' && res.result) {
          settled = true
          resolve(res.result)
          return
        }
        if (res.status === 'failed') {
          settled = true
          reject(new Error(res.error_message || '题目生成失败'))
          return
        }
        if (attempts >= maxAttempts) {
          settled = true
          reject(new Error('出题超时，请稍后重试'))
          return
        }
        const delay = attempts < 6 ? initialIntervalMs : 950
        timer = setTimeout(tick, delay)
      } catch (err) {
        settled = true
        if (timer) clearTimeout(timer)
        reject(err)
      }
    }

    timer = setTimeout(tick, 220)
  })
}

export function getQuizImages(quizId: string) {
  return request<QuizImagesResponse>(`/quiz/${quizId}/images`)
}

/* ---- 报告 API ---- */

export function submitQuizReport(params: {
  quiz_id: string
  answer_records: ReportSubmitAnswerItem[]
}) {
  return request<ReportSubmitResponse>('/report/submit', {
    method: 'POST',
    data: {
      quiz_id: params.quiz_id,
      answer_records: params.answer_records.map((item) => ({
        question_id: item.question_id,
        selected_answers: item.selected_answers,
        duration_ms: item.duration_ms,
        mark_review: item.mark_review ?? false,
      })),
    },
    timeout: 30000,
  })
}

export function getReportStatus(quizId: string) {
  return request<ReportStatusResponse>(`/report/${quizId}`)
}

export function pollReportStatus(
  quizId: string,
  onUpdate?: (status: ReportStatusResponse) => void,
  options?: {
    intervalMs?: number
    maxAttempts?: number
    isCancelled?: () => boolean
  },
): Promise<ReportStatusResponse> {
  const initialMs = options?.intervalMs ?? 700
  const maxAttempts = options?.maxAttempts ?? 120
  const isCancelled = options?.isCancelled

  return new Promise((resolve, reject) => {
    let attempts = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    let settled = false

    const tick = async () => {
      if (settled || isCancelled?.()) {
        if (timer) clearTimeout(timer)
        return
      }
      attempts++
      try {
        const res = await getReportStatus(quizId)
        if (isCancelled?.()) {
          settled = true
          return
        }
        onUpdate?.(res)
        if (res.report_status === 'completed' || res.report_status === 'failed') {
          settled = true
          resolve(res)
          return
        }
        if (attempts >= maxAttempts) {
          settled = true
          reject(new Error('复盘报告生成超时，请稍后在历史记录中查看'))
          return
        }
        const delay = attempts < 8 ? initialMs : 1100
        timer = setTimeout(tick, delay)
      } catch (err) {
        settled = true
        if (timer) clearTimeout(timer)
        if (!isCancelled?.()) {
          reject(err)
        }
      }
    }

    timer = setTimeout(tick, Math.min(500, initialMs))
  })
}

export function generateReport(params: {
  quiz_id: string
  topic: string
  questions: Question[]
  answer_records: AnswerRecord[]
}) {
  return request<ReportData>('/report/generate', {
    method: 'POST',
    data: params,
    timeout: 600000,
  })
}

/* ---- V2 图谱、记忆曲线与错题复习 API（兼容 Stage 1 V1 后端未升级前的平滑降级） ---- */

export async function getMasteryOverview(domainId?: number): Promise<MasteryOverviewResponse | null> {
  try {
    const q = domainId ? `?domain_id=${domainId}` : ''
    return await request<MasteryOverviewResponse>(`/mastery/overview${q}`)
  } catch {
    return null
  }
}

export async function getDueReviews(
  limit = 20,
  opts?: { domainId?: number; includeAll?: boolean },
): Promise<DueReviewsResponse | null> {
  try {
    const query: string[] = [`limit=${limit}`]
    if (opts?.domainId) query.push(`domain_id=${opts.domainId}`)
    if (opts?.includeAll) query.push('include_all=true')
    return await request<DueReviewsResponse>(`/reviews/due?${query.join('&')}`)
  } catch {
    return null
  }
}

export interface ReviewPracticeItemInput {
  card_id: number
  selected_answers: string[]
  is_correct: boolean
  duration_ms: number
  mark_review?: boolean
}

export interface ReviewPracticeSubmitResponse {
  practiced_count: number
  correct_count: number
  graduated_count: number
  remaining_due: number
  streak_days: number
}

export async function submitInstantReviewPractice(
  items: ReviewPracticeItemInput[],
): Promise<ReviewPracticeSubmitResponse | null> {
  try {
    return await request<ReviewPracticeSubmitResponse>('/reviews/practice/submit', {
      method: 'POST',
      data: { items },
    })
  } catch {
    return null
  }
}

export async function markQuestionForReview(params: {
  quiz_id: string
  question_id: string
  action?: 'add' | 'skip'
}): Promise<{ card_id: number; status: string } | null> {
  try {
    return await request<{ card_id: number; status: string }>('/reviews/mark', {
      method: 'POST',
      data: params,
    })
  } catch {
    return null
  }
}

export async function grantSubscribeQuota(params: {
  template_id?: string
  count?: number
  preferred_hour?: number
}): Promise<{ remaining_count: number } | null> {
  try {
    return await request<{ remaining_count: number }>('/reviews/subscribe', {
      method: 'POST',
      data: params,
    })
  } catch {
    return null
  }
}

/* ---- 用户与历史 API ---- */

export function getUserProfile() {
  return request<UserProfile>('/user/profile')
}

export function updateUserProfile(data: { nickname?: string; avatar_url?: string }) {
  return request<null>('/user/profile', {
    method: 'PUT',
    data,
  })
}

/** 头像上传（H5）：浏览器里已压缩好的图片 Blob，multipart 字段名 file；返回新的 avatar_url（后端已写回档案） */
export async function uploadAvatarWebFile(
  blob: Blob,
  fileName = 'avatar.jpg',
  _retried = false,
): Promise<{ avatar_url: string }> {
  const token = await ensureAuthToken()
  const formData = new FormData()
  formData.append('file', blob, fileName)
  let resp: Response
  try {
    resp = await fetch(`${BASE_URL}/user/avatar`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    })
  } catch {
    throw new Error('网络连接失败，请稍后重试')
  }
  let body: ApiResponse<{ avatar_url: string }>
  try {
    body = (await resp.json()) as ApiResponse<{ avatar_url: string }>
  } catch {
    throw new Error(resp.status === 413 ? '图片太大，请换一张' : '头像上传失败，请稍后重试')
  }
  if (body.code === 4010) {
    if (!_retried && (await ensureLogin(true))) {
      return uploadAvatarWebFile(blob, fileName, true)
    }
    clearToken()
    throw new Error('登录状态已过期，请重新登录')
  }
  if (body.code !== 0 || !body.data?.avatar_url) {
    throw new Error(body.message || '头像上传失败')
  }
  return body.data
}

/** 头像上传（小程序）：chooseAvatar 返回的临时文件路径 */
export async function uploadAvatarFromPath(filePath: string): Promise<{ avatar_url: string }> {
  const token = await ensureAuthToken()
  return new Promise((resolve, reject) => {
    Taro.uploadFile({
      url: `${BASE_URL}/user/avatar`,
      filePath,
      name: 'file',
      header: { Authorization: `Bearer ${token}` },
      timeout: 60000,
      success: (res) => {
        try {
          const body = JSON.parse(res.data) as ApiResponse<{ avatar_url: string }>
          if (body.code !== 0 || !body.data?.avatar_url) {
            reject(new Error(body.message || '头像上传失败'))
            return
          }
          resolve(body.data)
        } catch {
          reject(new Error('上传响应解析失败'))
        }
      },
      fail: (err) => reject(new Error(err.errMsg || '头像上传失败')),
    })
  })
}

export function getQuizHistory(page = 1, pageSize = 10) {
  return request<QuizHistoryList>(`/user/quizzes?page=${page}&page_size=${pageSize}`)
}

export function getQuizDetail(quizId: string) {
  return request<QuizDetailResponse>(`/user/quizzes/${quizId}`)
}

/* ---- 知识库 API（支持微信小程序 uploadFile 与 H5 File 双端上传） ---- */

export async function uploadKnowledgeDocumentFromPath(
  filePath: string,
  fileName: string,
  _retried = false,
): Promise<KnowledgeUploadResponse> {
  const token = await ensureAuthToken()
  const header: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  }

  return new Promise((resolve, reject) => {
    Taro.uploadFile({
      url: `${BASE_URL}/knowledge/documents`,
      filePath,
      name: 'file',
      fileName,
      header,
      timeout: 120000,
      success: async (res) => {
        try {
          const body = JSON.parse(res.data) as ApiResponse<KnowledgeUploadResponse>
          if (body.code === 4010) {
            if (!_retried && (await ensureLogin(true))) {
              try {
                resolve(await uploadKnowledgeDocumentFromPath(filePath, fileName, true))
                return
              } catch (retryErr) {
                reject(retryErr)
                return
              }
            }
            clearToken()
            reject(new Error('登录已过期，请重新进入小程序'))
            return
          }
          if (body.code !== 0) {
            reject(new Error(body.message || '上传失败'))
            return
          }
          resolve(body.data)
        } catch {
          reject(new Error('上传响应解析失败'))
        }
      },
      fail: (err) => reject(new Error(err.errMsg || '上传失败')),
    })
  })
}

export async function uploadKnowledgeDocumentFromWebFile(
  file: File,
  _retried = false,
): Promise<KnowledgeUploadResponse> {
  const token = await ensureAuthToken()
  const formData = new FormData()
  formData.append('file', file, file.name)

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  }

  const resp = await fetch(`${BASE_URL}/knowledge/documents`, {
    method: 'POST',
    headers,
    body: formData,
  })
  const body = (await resp.json()) as ApiResponse<KnowledgeUploadResponse>

  if (body.code === 4010) {
    if (!_retried && (await ensureLogin(true))) {
      return uploadKnowledgeDocumentFromWebFile(file, true)
    }
    clearToken()
    throw new Error('登录状态已过期，请刷新页面重试')
  }

  if (body.code !== 0) {
    throw new Error(body.message || '上传失败')
  }
  return body.data
}

export function getKnowledgeDocuments() {
  return request<KnowledgeListResponse>('/knowledge/documents')
}

export function getKnowledgeDocumentStatus(docId: string) {
  return request<KnowledgeDocumentStatus>(`/knowledge/documents/${docId}`)
}

export function deleteKnowledgeDocument(docId: string) {
  return request<null>(`/knowledge/documents/${docId}`, {
    method: 'DELETE',
  })
}

/* ---- 类型定义 ---- */

export interface QuestionOption {
  key: string
  text: string
}

export interface Question {
  id: string
  type: 'single' | 'multiple' | 'judge'
  stem: string
  options: QuestionOption[]
  answer: string[]
  explanation: string
  knowledge_point: string
  difficulty: 'easy' | 'medium' | 'hard'
  image_url?: string | null
  source_card_id?: number
}

export type QuizTaskStage = 'queued' | 'fetching_context' | 'generating_quiz' | 'completed' | 'failed'

export type QuizImageStatus = 'none' | 'generating' | 'completed' | 'partial' | 'failed'

export type ReportStatusEnum = 'generating' | 'completed' | 'failed'

export interface QuizData {
  quiz_id: string
  title: string
  summary: string
  questions: Question[]
  source_type?: QuizSourceType
  domain_id?: number
  domain_name?: string
  recommended_count?: number
  adaptive_reason?: string
  image_status?: QuizImageStatus
  image_notice?: string | null
  is_instant_review?: boolean
  source_review_card_ids?: number[]
}

export interface QuizTaskStatus {
  task_id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  stage?: QuizTaskStage
  stage_message?: string | null
  result: QuizData | null
  error_message: string | null
}

export interface QuizImagesResponse {
  quiz_id: string
  image_status: QuizImageStatus
  image_urls: Record<string, string>
  image_notice?: string | null
}

export interface AnswerRecord {
  question_id: string
  selected_answers: string[]
  is_correct: boolean
  duration_ms: number
  mark_review?: boolean
}

export interface ReportSubmitAnswerItem {
  question_id: string
  selected_answers: string[]
  duration_ms: number
  mark_review?: boolean
}

export interface ReportData {
  accuracy: number
  mastered_points: string[]
  weak_points: string[]
  three_line_summary: string[]
  advice: string[]
  share_quote: string
}

export interface ReportSubmitResponse {
  quiz_id: string
  accuracy: number
  correct_count: number
  wrong_count: number
  total_questions: number
  xp_gain: number
  xp_awarded: boolean
  already_submitted: boolean
  streak_days?: number
  domain_id?: number
  domain_name?: string
  domain_mastery_after?: number
  stability_days_after?: number
  due_cards_created?: number
  reviewed_cards_progressed?: number
  session_retention_curve?: RetentionCurvePoint[]
  weekly_rhythm?: WeeklyRhythmDay[]
  report_status: ReportStatusEnum
  report?: ReportData | null
  error_message?: string | null
}

export interface ReportStatusResponse {
  quiz_id: string
  report_status: ReportStatusEnum
  report?: ReportData | null
  error_message?: string | null
}

export interface UserBrief {
  id: number
  nickname: string
  avatar_url: string
  total_xp: number
  streak_days?: number
}

export interface LoginResponse {
  token: string
  user: UserBrief
}

export interface UserProfile {
  id: number
  nickname: string
  avatar_url: string
  total_xp: number
  streak_days?: number
  quiz_count: number
  correct_count: number
  average_accuracy: number
}

export interface QuizHistoryItem {
  quiz_id: string
  title: string
  accuracy: number
  question_count: number
  domain_id?: number
  domain_name?: string
  source_type?: QuizSourceType
  is_submitted?: boolean
  created_at: string
}

export interface QuizHistoryList {
  items: QuizHistoryItem[]
  total: number
  page: number
  page_size: number
}

export interface QuizDetailResponse {
  quiz_id: string
  title: string
  summary: string
  user_input?: string
  source_type?: QuizSourceType
  domain_id?: number
  domain_name?: string
  questions: Question[]
  image_status?: QuizImageStatus
  image_notice?: string | null
  answer_records?: AnswerRecord[]
  report?: ReportData | null
  report_status?: ReportStatusEnum | null
  report_error?: string | null
  created_at: string
}

export type KnowledgeDocumentStatusEnum = 'processing' | 'ready' | 'failed'

export interface KnowledgeUploadResponse {
  doc_id: string
  file_name: string
  status: KnowledgeDocumentStatusEnum
  domain_id?: number
  domain_name?: string
}

export interface KnowledgeDocumentItem {
  doc_id: string
  file_name: string
  file_type: string
  file_size: number
  status: KnowledgeDocumentStatusEnum
  chunk_count: number
  domain_id?: number
  domain_name?: string
  error_message: string | null
  created_at: string
}

export interface KnowledgeListResponse {
  items: KnowledgeDocumentItem[]
}

export interface KnowledgeDocumentStatus {
  doc_id: string
  file_name: string
  status: KnowledgeDocumentStatusEnum
  chunk_count: number
  domain_id?: number
  domain_name?: string
  error_message: string | null
}

export interface DifficultyMatrixStats {
  easy_accuracy: number
  medium_accuracy: number
  hard_accuracy: number
  easy_total: number
  medium_total: number
  hard_total: number
}

export interface DomainMasterySummary {
  domain_id: number
  name: string
  color_token: string
  doc_count: number
  mastery_score: number
  retention_rate: number
  stability_days: number
  due_review_count: number
  recommended_count: number
  below_threshold: boolean
  next_review_day_label?: string
  next_recommended_difficulty?: string
  schedule_reason?: string
  difficulty_stats: DifficultyMatrixStats
  /** 该域是否已有真实答题（后端 2026-11-25 起返回；旧后端缺省时按难度统计推断） */
  has_practice?: boolean
}

export interface RetentionCurvePoint {
  day_label: string
  retention_pct: number
  baseline_pct?: number
  is_today?: boolean
  is_recovery?: boolean
  is_actual?: boolean
  quiz_title?: string
}

export interface WeeklyRhythmSessionItem {
  quiz_id: string
  title: string
  domain_name: string
  question_count: number
  accuracy: number
  weak_points: string[]
}

export interface WeeklyRhythmDay {
  day_label: string
  date_num: string
  date_str?: string
  completed_count: number
  quiz_count?: number
  avg_accuracy?: number | null
  is_today: boolean
  active: boolean
  sessions?: WeeklyRhythmSessionItem[]
}

export interface MasteryScheduleSummary {
  domain_id?: number
  domain_name: string
  when_label: string
  recommended_count: number
  focus_difficulty: string
  critical_days: number
  reason: string
}

export interface MasteryOverviewResponse {
  streak_days: number
  overall_retention: number
  due_review_total: number
  subscribe_remaining: number
  focus_domain: DomainMasterySummary | null
  next_plan?: MasteryScheduleSummary | null
  domains: DomainMasterySummary[]
  retention_curve: RetentionCurvePoint[]
  weekly_rhythm: WeeklyRhythmDay[]
  seven_day_forecast: number[]
  /** 用户是否有任何真实答题数据；false 时各页显示空状态 */
  has_practice_data?: boolean
}

export interface DueReviewCardItem {
  card_id: number
  question_id: string
  quiz_id: string
  domain_id?: number
  domain_name: string
  q_type?: 'single' | 'multiple' | 'judge'
  stem: string
  options?: QuestionOption[]
  answer?: string[]
  explanation?: string
  user_selected?: string[]
  knowledge_point: string
  difficulty: 'easy' | 'medium' | 'hard'
  repetitions?: number
  interval_days: number
  status?: string
  next_review_at: string
  last_reviewed_at?: string | null
}

export interface DueReviewsResponse {
  total_due: number
  unresolved_total?: number
  domain_id?: number | null
  items: DueReviewCardItem[]
}
