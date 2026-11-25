import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DueReviewCardItem, KnowledgeDocumentItem, QuizHistoryItem, WeeklyRhythmDay } from './api'

type Adapters = typeof import('./v2Adapters')

async function load(): Promise<Adapters> {
  vi.resetModules()
  return import('./v2Adapters')
}

let A: Adapters
beforeEach(async () => {
  A = await load()
})

const hist = (created_at: string, accuracy: number, extra: Partial<QuizHistoryItem> = {}): QuizHistoryItem => ({
  quiz_id: `q_${created_at}`,
  title: 'HTTP/3 握手',
  accuracy,
  question_count: 5,
  is_submitted: true,
  created_at,
  ...extra,
})

describe('SWR 缓存', () => {
  it('写入后可读，过期后读不到', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-24T10:00:00+08:00'))
    A.writeSwrCache('mastery_ov_all', { a: 1 })
    expect(A.readSwrCache('mastery_ov_all')).toEqual({ a: 1 })
    vi.setSystemTime(new Date('2026-11-24T10:06:00+08:00'))
    expect(A.readSwrCache('mastery_ov_all')).toBeNull()
    expect(A.readSwrCache('mastery_ov_all', 600_000)).toEqual({ a: 1 })
  })

  it('内存丢失后从本地存储回填', async () => {
    A.writeSwrCache('home_x', [1, 2])
    const fresh = await load()
    expect(fresh.readSwrCache('home_x')).toEqual([1, 2])
  })

  it('invalidateSwrCache 按前缀清理内存与存储', async () => {
    A.writeSwrCache('mastery_ov_all', 1)
    A.writeSwrCache('mastery_due_all', 2)
    A.writeSwrCache('home_ov', 3)
    A.invalidateSwrCache('mastery_')
    expect(A.readSwrCache('mastery_ov_all')).toBeNull()
    expect(A.readSwrCache('mastery_due_all')).toBeNull()
    expect(A.readSwrCache('home_ov')).toBe(3)
    const fresh = await load()
    expect(fresh.readSwrCache('mastery_ov_all')).toBeNull()
  })
})

describe('日期工具', () => {
  it('formatLocalDate 用本地时区（北京时间凌晨不会错成前一天）', () => {
    // 2026-11-24 02:30 北京时间 = 2026-11-23 18:30 UTC
    const d = new Date(2026, 10, 24, 2, 30)
    expect(A.formatLocalDate(d)).toBe('2026-11-24')
  })

  it('parseServerDate 兼容空格分隔格式并拒绝非法值', () => {
    expect(A.parseServerDate('2026-11-20 10:00:00')?.getDate()).toBe(20)
    expect(A.parseServerDate('2026-11-20T10:00:00')?.getHours()).toBe(10)
    expect(A.parseServerDate('not a date')).toBeNull()
    expect(A.parseServerDate(undefined)).toBeNull()
  })
})

describe('buildRealCalendarStrip', () => {
  it('后端 WeeklyRhythmDay[] 直接映射并补齐默认字段', () => {
    const days = Array.from({ length: 9 }, (_, i) => ({
      day_label: `${i}`,
      date_num: `${i}`,
      completed_count: i,
      is_today: i === 8,
      active: true,
    })) as WeeklyRhythmDay[]
    const strip = A.buildRealCalendarStrip(days)
    expect(strip).toHaveLength(7)
    expect(strip[0].day_label).toBe('2')
    expect(strip[6]).toMatchObject({ is_today: true, quiz_count: 0, avg_accuracy: null, sessions: [] })
  })

  it('数字数组生成「今天 -4 ~ +2」窗口，date_str 用本地日期', () => {
    const now = new Date(2026, 10, 24, 2, 30)
    const strip = A.buildRealCalendarStrip([1, 0, 0, 0, 3, 0, 0], now)
    expect(strip.map((d) => d.date_str)).toEqual([
      '2026-11-20',
      '2026-11-21',
      '2026-11-22',
      '2026-11-23',
      '2026-11-24',
      '2026-11-25',
      '2026-11-26',
    ])
    expect(strip[4]).toMatchObject({ is_today: true, completed_count: 3, day_label: '二' })
    expect(strip[0].active).toBe(true)
    expect(strip[1].active).toBe(false)
  })
})

describe('记忆曲线兜底（回归：曲线每天一样）', () => {
  const history = [
    hist('2026-11-18 20:00:00', 60),
    hist('2026-11-20 21:00:00', 72),
    hist('2026-11-22 09:00:00', 85),
  ]

  it('没有已交卷记录时兜底总览是空的：无 74% 保持率、无示例域、预测全 0', () => {
    for (const items of [[], [hist('2026-11-20 10:00:00', 90, { is_submitted: false })]]) {
      const ov = A.buildFallbackMasteryOverview(items, [], new Date(2026, 10, 24))
      expect(ov.overall_retention).toBe(0)
      expect(ov.domains).toEqual([])
      expect(ov.focus_domain).toBeNull()
      expect(ov.next_plan).toBeNull()
      expect(ov.streak_days).toBe(0)
      expect(ov.seven_day_forecast).toEqual([0, 0, 0, 0, 0, 0, 0])
      expect(A.hasPracticeData(ov)).toBe(false)
    }
  })

  it('有交卷记录时兜底总览不编造分难度统计', () => {
    const ov = A.buildFallbackMasteryOverview([hist('2026-11-22 09:00:00', 80)], [], new Date(2026, 10, 24))
    expect(A.hasPracticeData(ov)).toBe(true)
    expect(ov.focus_domain?.difficulty_stats.easy_total).toBe(0)
    expect(ov.focus_domain?.difficulty_stats.easy_accuracy).toBe(0)
  })

  it('hasPracticeData / domainHasPractice：优先后端标记，旧后端按难度统计推断', () => {
    expect(A.hasPracticeData(null)).toBe(false)
    expect(A.hasPracticeData({ has_practice_data: false, domains: [{ has_practice: true }] } as any)).toBe(false)
    expect(A.hasPracticeData({ domains: [{ difficulty_stats: { easy_total: 0, medium_total: 2, hard_total: 0 } }] } as any)).toBe(true)
    expect(A.hasPracticeData({ domains: [], weekly_rhythm: [{ completed_count: 3 }] } as any)).toBe(true)
    expect(A.hasPracticeData({ domains: [], weekly_rhythm: [] } as any)).toBe(false)
    expect(A.domainHasPractice(undefined)).toBe(false)
    expect(A.domainHasPractice({ difficulty_stats: { easy_total: 0, medium_total: 0, hard_total: 0 } } as any)).toBe(false)
    expect(A.domainHasPractice({ retention_rate: 70 } as any)).toBe(true)
  })

  it('没有任何历史时返回空数组，不再伪造固定曲线', () => {
    expect(A.buildRetentionCurveFromHistory([], new Date(2026, 10, 24))).toEqual([])
    const ov = A.buildFallbackMasteryOverview([], [], new Date(2026, 10, 24))
    expect(ov.retention_curve).toEqual([])
    expect(ov.weekly_rhythm.every((d) => d.completed_count === 0)).toBe(true)
  })

  it('左段是真实测验节点（日期 + 正确率）', () => {
    const curve = A.buildRetentionCurveFromHistory(history, new Date(2026, 10, 24, 10))
    const actual = curve.filter((p) => p.is_actual)
    expect(actual.map((p) => p.day_label)).toEqual(['11/18', '11/20', '11/22'])
    expect(actual.map((p) => p.retention_pct)).toEqual([60, 72, 85])
  })

  it('同一份历史，不同日期打开 → 今日点与投影段都不同', () => {
    const day1 = A.buildRetentionCurveFromHistory(history, new Date(2026, 10, 23, 10))
    const day3 = A.buildRetentionCurveFromHistory(history, new Date(2026, 10, 25, 10))
    const today1 = day1.find((p) => p.is_today)!
    const today3 = day3.find((p) => p.is_today)!
    expect(today3.retention_pct).toBeLessThan(today1.retention_pct)
    const proj = (c: typeof day1) => c.filter((p) => !p.is_actual && !p.is_today).map((p) => p.retention_pct)
    expect(proj(day1)).not.toEqual(proj(day3))
  })

  it('未交卷与未来时间的记录不参与曲线', () => {
    const curve = A.buildRetentionCurveFromHistory(
      [hist('2026-11-20 10:00:00', 50), hist('2026-11-21 10:00:00', 99, { is_submitted: false }), hist('2026-12-30 10:00:00', 10)],
      new Date(2026, 10, 24),
    )
    expect(curve.filter((p) => p.is_actual).map((p) => p.retention_pct)).toEqual([50])
  })

  it('projectRetentionAfterReview：巩固后不低于今日、不高于 98，越临近遗忘增益越大', () => {
    for (const nowRet of [18, 45, 80, 97]) {
      const [boost] = A.projectRetentionAfterReview(nowRet, 70)
      expect(boost.retention_pct).toBeGreaterThanOrEqual(nowRet)
      expect(boost.retention_pct).toBeLessThanOrEqual(98)
    }
    const low = A.projectRetentionAfterReview(40, 70)[0].retention_pct - 40
    const high = A.projectRetentionAfterReview(80, 70)[0].retention_pct - 80
    expect(low).toBeGreaterThan(high)
  })

  it('computeRetentionRate 与后端一致：R(t)=100e^(-t/S)，下限 18', () => {
    expect(A.computeRetentionRate(0, 5)).toBe(100)
    expect(A.computeRetentionRate(5, 5)).toBeCloseTo(36.79, 1)
    expect(A.computeRetentionRate(100, 5)).toBe(18)
  })

  it('兜底节律条按本地日期聚合真实题量（不再是写死的 48/64/35…）', () => {
    const now = new Date(2026, 10, 24, 1, 0)
    const counts = A.buildWeeklyCountsFromHistory(
      [
        hist('2026-11-24 00:30:00', 80, { question_count: 6 }),
        hist('2026-11-22 23:50:00', 80, { question_count: 4 }),
        hist('2026-11-22 08:00:00', 80, { question_count: 3 }),
        hist('2026-11-10 08:00:00', 80, { question_count: 9 }),
        hist('2026-11-23 08:00:00', 80, { question_count: 9, is_submitted: false }),
      ],
      now,
    )
    expect(counts).toEqual([0, 0, 7, 0, 6, 0, 0])
    const ov = A.buildFallbackMasteryOverview([hist('2026-11-24 00:30:00', 80, { question_count: 6 })], [], now)
    expect(ov.weekly_rhythm.find((d) => d.is_today)?.completed_count).toBe(6)
  })
})

describe('其他适配器', () => {
  it('computeRecommendedCount：倒 U 题量', () => {
    expect(A.computeRecommendedCount('familiar', 30)).toBe(4)
    expect(A.computeRecommendedCount('familiar', 60)).toBe(6)
    expect(A.computeRecommendedCount('familiar', 90)).toBe(3)
    expect(A.computeRecommendedCount('unfamiliar')).toBe(4)
    expect(A.computeRecommendedCount('mastered', null)).toBe(3)
    expect(A.computeRecommendedCount('familiar', 0)).toBe(6)
  })

  it('inferDomainFromText 关键词归类，未命中归综合', () => {
    expect(A.inferDomainFromText('QUIC 与 TCP 对比').name).toBe('计算机网络')
    expect(A.inferDomainFromText('BM25 + RRF 混合检索').name).toBe('RAG 架构')
    expect(A.inferDomainFromText('光合作用')).toEqual({ name: '综合知识域', theme: 'blue' })
  })

  it('buildInstantReviewQuiz：最多 10 题，判断题补默认选项，带上源卡片 ID', () => {
    const cards = Array.from({ length: 12 }, (_, i) => ({
      card_id: i + 1,
      question_id: `q${i}`,
      quiz_id: 'quiz_1',
      stem: `题 ${i}`,
      q_type: i === 0 ? 'judge' : 'single',
      options: i === 0 ? [] : [{ key: 'C', text: 'c' }],
      answer: i === 0 ? [] : ['C'],
      knowledge_point: 'kp',
      domain_name: '网络',
      domain_id: 3,
    })) as unknown as DueReviewCardItem[]
    const q = A.buildInstantReviewQuiz(cards)
    expect(q.questions).toHaveLength(10)
    expect(q.questions[0].options.map((o) => o.text)).toEqual(['正确', '错误'])
    expect(q.questions[0].answer).toEqual(['A'])
    expect(q.questions[1].answer).toEqual(['C'])
    expect(q.quiz_id.startsWith('revq_')).toBe(true)
    expect(q.source_review_card_ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(q.title).toBe('网络 · 错题秒开回顾')
  })

  it('groupDocumentsToPockets：按领域聚类并优先使用后端保持率', () => {
    const docs = [
      { doc_id: 'd1', file_name: 'http3.pdf', file_type: 'pdf', status: 'ready', chunk_count: 3 },
      { doc_id: 'd2', file_name: 'tcp.md', file_type: 'md', status: 'processing', chunk_count: 0 },
      { doc_id: 'd3', file_name: 'rag.md', file_type: 'md', status: 'ready', chunk_count: 2, domain_name: 'RAG 架构' },
    ] as unknown as KnowledgeDocumentItem[]
    const pockets = A.groupDocumentsToPockets(docs, {
      domains: [{ name: 'RAG 架构', retention_rate: 61.4, color_token: 'butter' }],
    } as any)
    const net = pockets.find((p) => p.name === '计算机网络')!
    expect(net.docs).toHaveLength(2)
    expect(net.readyCount).toBe(1)
    expect(pockets.find((p) => p.name === 'RAG 架构')!.retentionPct).toBe(61)
  })

  it('新用户没有文档：不再预置「计算机网络」「RAG 架构」示例口袋', () => {
    expect(A.groupDocumentsToPockets([], null)).toEqual([])
  })

  it('口袋所在域还没答过题：保持率为 null（显示「未练习」），不再编造 58–86%', () => {
    const docs = [{ doc_id: 'd1', file_name: '操作系统.pdf', file_type: 'pdf', status: 'ready', chunk_count: 3, domain_name: '操作系统' }] as unknown as KnowledgeDocumentItem[]
    const unpracticed = A.groupDocumentsToPockets(docs, {
      domains: [{ name: '操作系统', retention_rate: 0, has_practice: false, color_token: 'sage' }],
    } as any)
    expect(unpracticed[0].retentionPct).toBeNull()
    expect(A.groupDocumentsToPockets(docs, null)[0].retentionPct).toBeNull()
  })

  it('buildEmptyDueReviews', () => {
    expect(A.buildEmptyDueReviews()).toEqual({ total_due: 0, unresolved_total: 0, items: [] })
  })
})
