import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DueReviewCardItem, KnowledgeDocumentItem, WeeklyRhythmDay } from './api'

type Adapters = typeof import('./v2Adapters')

async function load(): Promise<Adapters> {
  vi.resetModules()
  return import('./v2Adapters')
}

let A: Adapters
beforeEach(async () => {
  A = await load()
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

  it('buildEmptyDueReviews', () => {
    expect(A.buildEmptyDueReviews()).toEqual({ total_due: 0, unresolved_total: 0, items: [] })
  })
})
