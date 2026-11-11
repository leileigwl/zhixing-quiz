import type {
  DueReviewsResponse,
  KnowledgeDocumentItem,
  MasteryOverviewResponse,
  QuizHistoryItem,
  RetentionCurvePoint,
  SelfRatedLevel,
  WeeklyRhythmDay,
} from './api'

const WEEK_LABELS = ['日', '一', '二', '三', '四', '五', '六']

/** 计算真实今日前后 7 日节律条（今日默认居第 5 格，对应 MOVEPOP 视觉重心） */
export function buildRealCalendarStrip(activeDates: number[] = []): WeeklyRhythmDay[] {
  const now = new Date()
  const result: WeeklyRhythmDay[] = []
  for (let offset = -4; offset <= 2; offset++) {
    const d = new Date(now)
    d.setDate(now.getDate() + offset)
    const dayIdx = d.getDay()
    const dd = String(d.getDate()).padStart(2, '0')
    result.push({
      day_label: WEEK_LABELS[dayIdx],
      date_num: dd,
      completed_count: offset === 0 ? Math.max(activeDates[4] ?? 1, 1) : activeDates[offset + 4] ?? 0,
      is_today: offset === 0,
      active: offset <= 0,
    })
  }
  return result
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
    { day_label: 'D1', retention_pct: 92 },
    { day_label: 'D3', retention_pct: 74 },
    { day_label: 'D5', retention_pct: 58 },
    { day_label: '重测前', retention_pct: 46, is_today: true },
    { day_label: '今日巩固', retention_pct: Math.min(96, Math.max(88, latestAcc)), is_recovery: true },
    { day_label: '+7天', retention_pct: 85 },
    { day_label: '+14天', retention_pct: 79 },
  ]

  const weekHeights = [48, 64, 35, 78, 56, 42, Math.max(66, Math.min(94, latestAcc))]
  const calendar = buildRealCalendarStrip(weekHeights)

  return {
    streak_days: Math.max(1, historyItems.length),
    overall_retention: latestAcc,
    due_review_total: historyItems.filter((h) => h.accuracy < 80).length,
    subscribe_remaining: 0,
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
  return { total_due: 0, items: [] }
}
