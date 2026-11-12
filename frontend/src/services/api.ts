import Taro from '@tarojs/taro'

// 由 config/dev.ts、config/prod.ts 中的 defineConstants 注入
declare const API_BASE_URL: string

const BASE_URL = API_BASE_URL
const TOKEN_KEY = 'zx_token'
const USER_KEY = 'zx_user_info'

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

async function ensureAuthToken(): Promise<string> {
  if (!getToken()) {
    const loggedIn = await ensureLogin()
    if (!loggedIn || !getToken()) {
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
