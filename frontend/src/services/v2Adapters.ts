import Taro from '@tarojs/taro'
import type {
  DueReviewCardItem,
  DueReviewsResponse,
  KnowledgeDocumentItem,
  MasteryOverviewResponse,
  Question,
  QuizData,
  QuizHistoryItem,
  RetentionCurvePoint,
  SelfRatedLevel,
  WeeklyRhythmDay,
} from './api'

const SWR_PREFIX = 'zx_swr_v21_'
const memorySwr = new Map<string, { ts: number; data: unknown }>()

export function readSwrCache<T>(key: string, maxAgeMs = 300_000): T | null {
  const fullKey = `${SWR_PREFIX}${key}`
  const mem = memorySwr.get(fullKey)
  if (mem && Date.now() - mem.ts <= maxAgeMs) {
    return mem.data as T
  }
  try {
    const raw = Taro.getStorageSync(fullKey)
    if (raw && typeof raw === 'object' && 'ts' in raw && 'data' in raw) {
      const parsed = raw as { ts: number; data: T }
      if (Date.now() - parsed.ts <= maxAgeMs) {
        memorySwr.set(fullKey, parsed)
        return parsed.data
      }
    }
  } catch {
    // 忽略部分运行环境的存储限制
  }
  return null
}

export function writeSwrCache<T>(key: string, data: T): void {
  const fullKey = `${SWR_PREFIX}${key}`
  const payload = { ts: Date.now(), data }
  memorySwr.set(fullKey, payload)
  try {
    Taro.setStorageSync(fullKey, payload)
  } catch {
    // 忽略超出容量的缓存写入
  }
}

export function invalidateSwrCache(prefix?: string): void {
  const target = prefix ? `${SWR_PREFIX}${prefix}` : SWR_PREFIX
  Array.from(memorySwr.keys()).forEach((k) => {
    if (k.startsWith(target)) {
      memorySwr.delete(k)
    }
  })
  try {
    const info = Taro.getStorageInfoSync()
    for (const k of info.keys || []) {
      if (k.startsWith(target)) {
        Taro.removeStorageSync(k)
      }
    }
  } catch {
    // ignore
  }
}

const WEEK_LABELS = ['日', '一', '二', '三', '四', '五', '六']

/** 计算真实 7 日节律条：优先直接映射后端 WeeklyRhythmDay[]，保留完整日期、局数与明细 */
export function buildRealCalendarStrip(input: number[] | WeeklyRhythmDay[] = []): WeeklyRhythmDay[] {
  if (Array.isArray(input) && input.length > 0 && typeof input[0] === 'object') {
    return (input as WeeklyRhythmDay[]).slice(-7).map((item) => ({
      day_label: item.day_label || '',
      date_num: item.date_num || '',
      date_str: item.date_str || '',
      completed_count: Number(item.completed_count || 0),
      quiz_count: Number(item.quiz_count || 0),
      avg_accuracy: item.avg_accuracy ?? null,
      is_today: Boolean(item.is_today),
      active: Boolean(item.active),
      sessions: Array.isArray(item.sessions) ? item.sessions : [],
    }))
  }

  const activeCounts = (Array.isArray(input) ? input : []) as number[]
  const now = new Date()
  const result: WeeklyRhythmDay[] = []
  for (let offset = -4; offset <= 2; offset++) {
    const d = new Date(now)
    d.setDate(now.getDate() + offset)
    const dayIdx = d.getDay()
    const dd = String(d.getDate()).padStart(2, '0')
    const count = activeCounts[offset + 4] ?? 0
    result.push({
      day_label: WEEK_LABELS[dayIdx],
      date_num: dd,
      date_str: d.toISOString().slice(0, 10),
      completed_count: count,
      quiz_count: 0,
      avg_accuracy: null,
      is_today: offset === 0,
      active: offset === 0 || count > 0,
      sessions: [],
    })
  }
  return result
}

/** 将待复习错题卡片在前端 <50ms 组装为即点即刷的复习测验，无需等待 25s LLM 变式出题 */
export function buildInstantReviewQuiz(
  cards: DueReviewCardItem[],
  focusDomainName?: string,
): QuizData {
  const usable = cards.slice(0, 10)
  const questions: Question[] = usable.map((card, idx) => {
    const qType = card.q_type || 'single'
    const fallbackOpts =
      qType === 'judge'
        ? [
            { key: 'A', text: '正确' },
            { key: 'B', text: '错误' },
          ]
        : [
            { key: 'A', text: '参考解析要点 A' },
            { key: 'B', text: '参考解析要点 B' },
          ]
    const options = card.options && card.options.length > 0 ? card.options : fallbackOpts
    return {
      id: card.question_id || `card_${card.card_id}_${idx}`,
      type: qType,
      stem: card.stem,
      options,
      answer: card.answer && card.answer.length > 0 ? card.answer : [options[0].key],
      explanation:
        card.explanation ||
        `本题考查「${card.knowledge_point || '核心概念'}」，点击下方 AI 同类变式题可深入拓展。`,
      knowledge_point: card.knowledge_point || '核心要点',
      difficulty: card.difficulty || 'medium',
      source_card_id: card.card_id,
    }
  })

  const domainLabel =
    focusDomainName || (usable[0]?.domain_name ? `${usable[0].domain_name}` : '待巩固错题')

  return {
    quiz_id: `revq_${Date.now()}`,
    title: `${domainLabel} · 错题秒开回顾`,
    summary: `直接加载 ${questions.length} 道高频错题，作答后立即推进 SM-2 记忆间隔`,
    questions,
    source_type: 'kb_rag',
    domain_id: usable[0]?.domain_id,
    domain_name: domainLabel,
    is_instant_review: true,
    source_review_card_ids: usable.map((c) => c.card_id),
  }
}

/** 倒 U 自适应推荐题量：冷启动自评 / 历史掌握分驱动 */
export function computeRecommendedCount(
  selfRated: SelfRatedLevel,
  masteryScore?: number | null,
): number {
  if (typeof masteryScore === 'number' && masteryScore > 0) {
    if (masteryScore < 45) return 4
    if (masteryScore < 80) return 6
    return 3
  }
  if (selfRated === 'unfamiliar') return 4
  if (selfRated === 'mastered') return 3
  return 6
}

export type PocketTheme = 'blue' | 'butter' | 'purple' | 'sage'

const POCKET_THEMES: PocketTheme[] = ['blue', 'butter', 'purple', 'sage']

const KEYWORD_DOMAIN_RULES: Array<{ domain: string; keywords: string[]; theme: PocketTheme }> = [
  { domain: '计算机网络', keywords: ['http', 'tcp', 'quic', '网络', 'udp', 'dns', 'tls'], theme: 'blue' },
  { domain: 'RAG 架构', keywords: ['rag', 'bm25', 'rrf', 'chroma', 'embedding', '检索', '向量'], theme: 'butter' },
  { domain: '后端分布式', keywords: ['redis', 'mysql', 'arq', 'fastapi', '并发', 'docker', '系统'], theme: 'purple' },
  { domain: '核心英语', keywords: ['english', '英语', 'word', 'vocab', '词', '语法'], theme: 'sage' },
]

export function inferDomainFromText(text: string): { name: string; theme: PocketTheme } {
  const lower = (text || '').toLowerCase()
  for (const rule of KEYWORD_DOMAIN_RULES) {
    if (rule.keywords.some((kw) => lower.includes(kw))) {
      return { name: rule.domain, theme: rule.theme }
    }
  }
  return { name: '综合知识域', theme: 'blue' }
}

export interface PocketBucket {
  name: string
  theme: PocketTheme
  docs: KnowledgeDocumentItem[]
  readyCount: number
  retentionPct: number
  previewTitle: string
  previewSnippet: string
}

/** 将文档列表按领域聚类成 DAYPATCH 半透明口袋 */
export function groupDocumentsToPockets(
  docs: KnowledgeDocumentItem[],
  overview?: MasteryOverviewResponse | null,
): PocketBucket[] {
  const domainMap = new Map<string, KnowledgeDocumentItem[]>()
  for (const doc of docs) {
    const label = doc.domain_name || inferDomainFromText(doc.file_name).name
    const existing = domainMap.get(label) || []
    existing.push(doc)
    domainMap.set(label, existing)
  }

  if (domainMap.size === 0) {
    return [
      {
        name: '计算机网络',
        theme: 'blue',
        docs: [],
        readyCount: 0,
        retentionPct: 46,
        previewTitle: '待装入口袋',
        previewSnippet: '上传 PDF / MD / Word 后自动归档切片',
      },
      {
        name: 'RAG 架构',
        theme: 'butter',
        docs: [],
        readyCount: 0,
        retentionPct: 78,
        previewTitle: '待装入口袋',
        previewSnippet: '支持多文档按主题智能归类整理',
      },
    ]
  }

  const buckets: PocketBucket[] = []
  let idx = 0
  domainMap.forEach((groupDocs, name) => {
    const matchedDomain = overview?.domains?.find((d) => d.name === name)
    const fallbackTheme = inferDomainFromText(name).theme || POCKET_THEMES[idx % POCKET_THEMES.length]
    const theme = (matchedDomain?.color_token as PocketTheme) || fallbackTheme
    const first = groupDocs[0]
    const readyCount = groupDocs.filter((d) => d.status === 'ready').length
    buckets.push({
      name,
      theme,
      docs: groupDocs,
      readyCount,
      retentionPct: matchedDomain ? Math.round(matchedDomain.retention_rate) : Math.max(58, 86 - idx * 12),
      previewTitle: first.file_name.replace(/\.[^.]+$/, '').slice(0, 14),
      previewSnippet: `${first.file_type.toUpperCase()} · ${first.chunk_count || 1} 知识片段`,
    })
    idx += 1
  })
  return buckets
}

/** 从 V1 历史记录组装兼容展示曲线（仅当后端 V2 尚未返回真实数据时兜底） */
export function buildFallbackMasteryOverview(
  historyItems: QuizHistoryItem[],
  docs: KnowledgeDocumentItem[],
): MasteryOverviewResponse {
  const latestAcc =
    historyItems.length > 0
      ? Math.round(historyItems.reduce((sum, item) => sum + item.accuracy, 0) / historyItems.length)
      : 74

  const focusName =
    historyItems[0]?.domain_name ||
    (historyItems[0]?.title ? inferDomainFromText(historyItems[0].title).name : 'RAG 架构')

  const retentionCurve: RetentionCurvePoint[] = [
    { day_label: 'D1', retention_pct: 92, baseline_pct: 88 },
    { day_label: 'D3', retention_pct: 74, baseline_pct: 66 },
    { day_label: 'D5', retention_pct: 58, baseline_pct: 48 },
    { day_label: '重测前', retention_pct: 46, baseline_pct: 38, is_today: true },
    {
      day_label: '今日巩固',
      retention_pct: Math.min(96, Math.max(76, latestAcc)),
      baseline_pct: 30,
      is_recovery: true,
    },
    { day_label: '+7天', retention_pct: 72, baseline_pct: 22 },
    { day_label: '+14天', retention_pct: 60, baseline_pct: 16 },
  ]

  const weekHeights = [48, 64, 35, 78, 56, 42, Math.max(66, Math.min(94, latestAcc))]
  const calendar = buildRealCalendarStrip(weekHeights)

  return {
    streak_days: Math.max(1, historyItems.length),
    overall_retention: latestAcc,
    due_review_total: historyItems.filter((h) => h.accuracy < 80).length,
    subscribe_remaining: 0,
    next_plan: {
      domain_id: 1,
      domain_name: focusName,
      when_label: '3 天后巩固',
      recommended_count: computeRecommendedCount('familiar', latestAcc),
      focus_difficulty: latestAcc < 50 ? '基础巩固为主' : '中等阶梯突破',
      critical_days: 3.5,
      reason: `按当前 ${latestAcc}% 保持率推算，建议 3 天后按 ${computeRecommendedCount('familiar', latestAcc)} 题巩固`,
    },
    focus_domain: {
      domain_id: 1,
      name: focusName,
      color_token: 'sky',
      doc_count: docs.length,
      mastery_score: latestAcc,
      retention_rate: latestAcc,
      stability_days: 7,
      due_review_count: 0,
      recommended_count: computeRecommendedCount('familiar', latestAcc),
      below_threshold: latestAcc < 50,
      difficulty_stats: {
        easy_accuracy: Math.min(100, latestAcc + 12),
        medium_accuracy: latestAcc,
        hard_accuracy: Math.max(40, latestAcc - 14),
        easy_total: 4,
        medium_total: 4,
        hard_total: 2,
      },
    },
    domains: [
      {
        domain_id: 1,
        name: focusName,
        color_token: 'sky',
        doc_count: Math.max(1, docs.length),
        mastery_score: latestAcc,
        retention_rate: latestAcc,
        stability_days: 7,
        due_review_count: 0,
        recommended_count: computeRecommendedCount('familiar', latestAcc),
        below_threshold: latestAcc < 50,
        difficulty_stats: {
          easy_accuracy: Math.min(100, latestAcc + 12),
          medium_accuracy: latestAcc,
          hard_accuracy: Math.max(40, latestAcc - 14),
          easy_total: 4,
          medium_total: 4,
          hard_total: 2,
        },
      },
    ],
    retention_curve: retentionCurve,
    weekly_rhythm: calendar,
    seven_day_forecast: [2, 1, 3, 2, 1, 0, 2],
  }
}

export function buildEmptyDueReviews(): DueReviewsResponse {
  return { total_due: 0, unresolved_total: 0, items: [] }
}
