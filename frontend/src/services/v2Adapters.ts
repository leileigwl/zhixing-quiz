import Taro from '@tarojs/taro'
import type {
  DomainMasterySummary,
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
const DAY_MS = 86_400_000

/** 本地时区 YYYY-MM-DD（不能用 toISOString：它是 UTC，北京时间 0~8 点会错成前一天） */
export function formatLocalDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

/** 解析后端时间串（兼容 `2026-11-20 10:00:00` 这种 iOS Safari 不认的格式）；无法解析返回 null */
export function parseServerDate(raw?: string | null): Date | null {
  if (!raw) return null
  const normalized = /^\d{4}-\d{2}-\d{2} \d/.test(raw) ? raw.replace(' ', 'T') : raw
  const d = new Date(normalized)
  return Number.isNaN(d.getTime()) ? null : d
}

/** 计算真实 7 日节律条：优先直接映射后端 WeeklyRhythmDay[]，保留完整日期、局数与明细 */
export function buildRealCalendarStrip(
  input: number[] | WeeklyRhythmDay[] = [],
  now: Date = new Date(),
): WeeklyRhythmDay[] {
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
      date_str: formatLocalDate(d),
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
  /** 该域真实保持率；还没答过题为 null（显示「未练习」） */
  retentionPct: number | null
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

  // 新用户没有任何文档：不再预置「计算机网络」「RAG 架构」等示例口袋，页面显示空状态
  if (domainMap.size === 0) return []

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
      retentionPct: matchedDomain && domainHasPractice(matchedDomain) ? Math.round(matchedDomain.retention_rate) : null,
      previewTitle: first.file_name.replace(/\.[^.]+$/, '').slice(0, 14),
      previewSnippet: `${first.file_type.toUpperCase()} · ${first.chunk_count || 1} 知识片段`,
    })
    idx += 1
  })
  return buckets
}

/** 与后端 adaptive_service.compute_retention_rate 一致：R(t) = 100·e^(-t/S)，夹在 [18, 100] */
export function computeRetentionRate(daysElapsed: number, stabilityDays: number): number {
  const s = Math.max(1, stabilityDays || 5)
  const t = Math.max(0, daysElapsed || 0)
  return Math.max(18, Math.min(100, 100 * Math.exp(-t / s)))
}

const round1 = (v: number) => Math.round(v * 10) / 10

/**
 * 「若今日巩固」后的投影段（与后端 mastery_service.build_retention_curve 总览态同一公式）：
 * 巩固后保持率随**今日**保持率与掌握分共同变化，而不是锚定在静态掌握分上。
 */
export function projectRetentionAfterReview(
  nowRet: number,
  masteryScore: number,
  stabilityDays = 5,
): RetentionCurvePoint[] {
  const sNew = Math.max(1.5, stabilityDays)
  const sBase = Math.max(1, sNew * 0.45)
  const sBoosted = Math.max(sNew * 1.35, 3.8)
  const gain = 0.35 + 0.4 * (Math.max(0, Math.min(100, masteryScore)) / 100)
  const boosted = round1(Math.min(98, nowRet + (100 - nowRet) * gain))
  const points: RetentionCurvePoint[] = [
    {
      day_label: '若巩固',
      retention_pct: boosted,
      baseline_pct: round1(Math.max(15, computeRetentionRate(1, sBase) * (nowRet / 100))),
      is_recovery: true,
    },
  ]
  for (const d of [3, 7, 14]) {
    points.push({
      day_label: `+${d}天`,
      retention_pct: round1(Math.max(15, computeRetentionRate(d, sBoosted) * (boosted / 100))),
      baseline_pct: round1(Math.max(15, computeRetentionRate(d, sBase) * (nowRet / 100))),
    })
  }
  return points
}

/**
 * 后端 /mastery/overview 不可用时，用**真实**历史练习记录推算记忆曲线：
 * 左段 = 最近 3 次已交卷正确率（按日期），今日点 = 最近一次正确率按 e^(-t/S) 衰减到今天，右段 = 若今日巩固的投影。
 * 没有任何可用历史时返回空数组（画布显示占位示意），不再伪造固定数值。
 */
export function buildRetentionCurveFromHistory(
  historyItems: QuizHistoryItem[],
  now: Date = new Date(),
  stabilityDays = 5,
): RetentionCurvePoint[] {
  const dated = historyItems
    .filter((h) => h.is_submitted !== false && typeof h.accuracy === 'number')
    .map((h) => ({ item: h, at: parseServerDate(h.created_at) }))
    .filter((x): x is { item: QuizHistoryItem; at: Date } => x.at !== null && x.at.getTime() <= now.getTime())
    .sort((a, b) => a.at.getTime() - b.at.getTime())
  if (dated.length === 0) return []

  const recent = dated.slice(-3)
  const points: RetentionCurvePoint[] = recent.map(({ item, at }) => {
    const acc = round1(Math.max(15, Math.min(99, item.accuracy)))
    return {
      day_label: `${String(at.getMonth() + 1).padStart(2, '0')}/${String(at.getDate()).padStart(2, '0')}`,
      retention_pct: acc,
      baseline_pct: acc,
      is_actual: true,
      quiz_title: (item.title || '').slice(0, 16),
    }
  })

  const last = recent[recent.length - 1]
  const daysElapsed = (now.getTime() - last.at.getTime()) / DAY_MS
  const nowRet = round1(
    Math.max(18, Math.min(98, last.item.accuracy * (computeRetentionRate(daysElapsed, stabilityDays) / 100))),
  )
  const masteryScore = recent.reduce((sum, r) => sum + r.item.accuracy, 0) / recent.length

  points.push({ day_label: '今日保持', retention_pct: nowRet, baseline_pct: nowRet, is_today: true })
  return points.concat(projectRetentionAfterReview(nowRet, masteryScore, stabilityDays))
}

/** 按本地日期把历史练习题量聚合到「今天 -4 ~ +2」7 日节律条（与后端 build_weekly_rhythm 的窗口一致） */
export function buildWeeklyCountsFromHistory(historyItems: QuizHistoryItem[], now: Date = new Date()): number[] {
  const counts = [0, 0, 0, 0, 0, 0, 0]
  const todayKey = formatLocalDate(now)
  const todayMidnight = parseServerDate(`${todayKey}T00:00:00`)!.getTime()
  for (const h of historyItems) {
    if (h.is_submitted === false) continue
    const at = parseServerDate(h.created_at)
    if (!at) continue
    const dayMidnight = parseServerDate(`${formatLocalDate(at)}T00:00:00`)!.getTime()
    const offset = Math.round((dayMidnight - todayMidnight) / DAY_MS)
    if (offset >= -4 && offset <= 2) counts[offset + 4] += Number(h.question_count || 0)
  }
  return counts
}

/** 某个知识域是否已有真实答题（优先用后端 has_practice；旧后端按难度统计 / 保持率推断） */
export function domainHasPractice(d: Partial<DomainMasterySummary> | null | undefined): boolean {
  if (!d) return false
  if (typeof d.has_practice === 'boolean') return d.has_practice
  const st = d.difficulty_stats
  if (st) return (st.easy_total || 0) + (st.medium_total || 0) + (st.hard_total || 0) > 0
  return (d.retention_rate || 0) > 0
}

/** 用户是否有任何真实答题数据：没有时「总体保持率 / 记忆曲线 / 下次复习」都显示空状态 */
export function hasPracticeData(ov: MasteryOverviewResponse | null | undefined): boolean {
  if (!ov) return false
  if (typeof ov.has_practice_data === 'boolean') return ov.has_practice_data
  if ((ov.domains || []).some((d) => domainHasPractice(d))) return true
  return (ov.weekly_rhythm || []).some((d) => (d.completed_count || 0) > 0)
}

/** 空总览：新用户 / 接口不可用且无历史时使用，所有数值为 0、列表为空，不伪造任何示例数据 */
export function buildEmptyMasteryOverview(now: Date = new Date()): MasteryOverviewResponse {
  return {
    streak_days: 0,
    overall_retention: 0,
    due_review_total: 0,
    subscribe_remaining: 0,
    next_plan: null,
    focus_domain: null,
    domains: [],
    retention_curve: [],
    weekly_rhythm: buildRealCalendarStrip(undefined, now),
    seven_day_forecast: [0, 0, 0, 0, 0, 0, 0],
    has_practice_data: false,
  }
}

/** 从 V1 历史记录组装兼容展示总览（仅当后端 V2 /mastery/overview 不可用时兜底；曲线与节律均来自真实历史） */
export function buildFallbackMasteryOverview(
  historyItems: QuizHistoryItem[],
  docs: KnowledgeDocumentItem[],
  now: Date = new Date(),
): MasteryOverviewResponse {
  const submitted = historyItems.filter((h) => h.is_submitted !== false && typeof h.accuracy === 'number')
  // 没有任何已交卷记录：返回空总览（不再兜底 74% / 「RAG 架构」示例域）
  if (submitted.length === 0) return buildEmptyMasteryOverview(now)
  const latestAcc = Math.round(submitted.reduce((sum, item) => sum + item.accuracy, 0) / submitted.length)

  const focusName =
    submitted[0]?.domain_name ||
    (submitted[0]?.title ? inferDomainFromText(submitted[0].title).name : '综合知识域')

  const retentionCurve = buildRetentionCurveFromHistory(historyItems, now)
  const calendar = buildRealCalendarStrip(buildWeeklyCountsFromHistory(historyItems, now), now)

  return {
    streak_days: 0,
    overall_retention: latestAcc,
    due_review_total: 0,
    has_practice_data: true,
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
      has_practice: true,
      difficulty_stats: {
        // 兜底路径拿不到分难度统计：全部置 0，难度卡片不显示（不再按正确率 ±12 编造）
        easy_accuracy: 0,
        medium_accuracy: 0,
        hard_accuracy: 0,
        easy_total: 0,
        medium_total: 0,
        hard_total: 0,
      },
    },
    domains: [
      {
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
        has_practice: true,
        difficulty_stats: {
          easy_accuracy: 0,
          medium_accuracy: 0,
          hard_accuracy: 0,
          easy_total: 0,
          medium_total: 0,
          hard_total: 0,
        },
      },
    ],
    retention_curve: retentionCurve,
    weekly_rhythm: calendar,
    seven_day_forecast: [0, 0, 0, 0, 0, 0, 0],
  }
}

export function buildEmptyDueReviews(): DueReviewsResponse {
  return { total_due: 0, unresolved_total: 0, items: [] }
}
