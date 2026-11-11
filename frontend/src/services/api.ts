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

      // H5 开发调试模式：自动调用 dev-login 获取可联调的真实 JWT
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
  const { body } = await rawRequest<T>(url, options)

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

  if (!body || body.code !== 0) {
    throw new Error(body?.message || '请求失败，请稍后重试')
  }

  return body.data
}

/* ---- 出题与任务轮询 API ---- */

export function generateQuizAsync(
  userInput: string,
  questionCount = 5,
  docId?: string,
  generateImages = false,
) {
  return request<{ task_id: string }>('/quiz/generate/async', {
    method: 'POST',
    data: {
      user_input: userInput,
      question_count: questionCount,
      difficulty: 'mixed',
      doc_id: docId,
      generate_images: generateImages,
    },
  })
}

export function getQuizTaskStatus(taskId: string) {
  return request<QuizTaskStatus>(`/quiz/task/${taskId}`)
}

/** 每 2 秒轮询一次异步出题任务状态（规避微信小程序 60s 请求超时） */
export function pollQuizTask(
  taskId: string,
  onProgress?: (status: string, task: QuizTaskStatus) => void,
  intervalMs = 2000,
  maxAttempts = 90,
): Promise<QuizData> {
  return new Promise((resolve, reject) => {
    let attempts = 0
    const timer = setInterval(async () => {
      attempts++
      try {
        const res = await getQuizTaskStatus(taskId)
        onProgress?.(res.status, res)

        if (res.status === 'completed' && res.result) {
          clearInterval(timer)
          resolve(res.result)
        } else if (res.status === 'failed') {
          clearInterval(timer)
          reject(new Error(res.error_message || '题目生成失败'))
        } else if (attempts >= maxAttempts) {
          clearInterval(timer)
          reject(new Error('出题超时，请稍后重试'))
        }
      } catch (err) {
        clearInterval(timer)
        reject(err)
      }
    }, intervalMs)
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
  const intervalMs = options?.intervalMs ?? 2000
  const maxAttempts = options?.maxAttempts ?? 90
  const isCancelled = options?.isCancelled

  return new Promise((resolve, reject) => {
    let attempts = 0
    const timer = setInterval(async () => {
      if (isCancelled?.()) {
        clearInterval(timer)
        return
      }
      attempts++
      try {
        const res = await getReportStatus(quizId)
        if (isCancelled?.()) {
          clearInterval(timer)
          return
        }
        onUpdate?.(res)
        if (res.report_status === 'completed' || res.report_status === 'failed') {
          clearInterval(timer)
          resolve(res)
        } else if (attempts >= maxAttempts) {
          clearInterval(timer)
          reject(new Error('复盘报告生成超时，请稍后在历史记录中查看'))
        }
      } catch (err) {
        clearInterval(timer)
        if (!isCancelled?.()) {
          reject(err)
        }
      }
    }, intervalMs)
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
}

export type QuizTaskStage = 'queued' | 'fetching_context' | 'generating_quiz' | 'completed' | 'failed'

export type QuizImageStatus = 'none' | 'generating' | 'completed' | 'partial' | 'failed'

export type ReportStatusEnum = 'generating' | 'completed' | 'failed'

export interface QuizData {
  quiz_id: string
  title: string
  summary: string
  questions: Question[]
  image_status?: QuizImageStatus
  image_notice?: string | null
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
}

export interface ReportSubmitAnswerItem {
  question_id: string
  selected_answers: string[]
  duration_ms: number
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
  quiz_count: number
  correct_count: number
  average_accuracy: number
}

export interface QuizHistoryItem {
  quiz_id: string
  title: string
  accuracy: number
  question_count: number
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
}

export interface KnowledgeDocumentItem {
  doc_id: string
  file_name: string
  file_type: string
  file_size: number
  status: KnowledgeDocumentStatusEnum
  chunk_count: number
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
  error_message: string | null
}
