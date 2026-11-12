import { useState, useEffect, useCallback, useMemo } from 'react'
import { View, Text, Textarea, Image, ScrollView } from '@tarojs/components'
import Taro, { useDidHide, useDidShow } from '@tarojs/taro'
import {
  ensureLogin,
  generateQuizAsync,
  pollQuizTask,
  getCachedUser,
  getUserProfile,
  setCachedUser,
  getQuizHistory,
  getKnowledgeDocuments,
  getMasteryOverview,
  getDueReviews,
  waitForLogin,
  type UserBrief,
  type QuizHistoryItem,
  type KnowledgeDocumentItem,
  type MasteryOverviewResponse,
  type DueReviewsResponse,
  type QuestionCountChoice,
  type SelfRatedLevel,
} from '../../services/api'
import { setActiveQuizSession } from '../../services/quizSessionStore'
import {
  buildEmptyDueReviews,
  buildFallbackMasteryOverview,
  buildInstantReviewQuiz,
  buildRealCalendarStrip,
  computeRecommendedCount,
  invalidateSwrCache,
  readSwrCache,
  writeSwrCache,
} from '../../services/v2Adapters'
import FloatingDock from '../../components/FloatingDock'
import GeometricProp from '../../components/GeometricProp'
import './index.scss'

const QUICK_TOPICS = ['RAG 检索', 'HTTP/3', '分布式锁']

const COUNT_CHOICES: Array<{ value: QuestionCountChoice; label: string }> = [
  { value: 3, label: '3题' },
  { value: 'adaptive', label: '自适应' },
  { value: 5, label: '5题' },
  { value: 10, label: '10题' },
]

const SELF_LEVELS: Array<{ value: SelfRatedLevel; label: string }> = [
  { value: 'unfamiliar', label: '陌生' },
  { value: 'familiar', label: '略懂' },
  { value: 'mastered', label: '熟练' },
]

export default function IndexPage() {
  const [inputValue, setInputValue] = useState('')
  const [referenceText, setReferenceText] = useState('')
  const [showReferenceInput, setShowReferenceInput] = useState(false)
  const [enableWebSearch, setEnableWebSearch] = useState(true)
  const [generateImages, setGenerateImages] = useState(false)
  const [questionChoice, setQuestionChoice] = useState<QuestionCountChoice>('adaptive')
  const [selfRated, setSelfRated] = useState<SelfRatedLevel>('familiar')
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([])
  const [selectedDomainId, setSelectedDomainId] = useState<number | undefined>(undefined)

  const [loading, setLoading] = useState(false)
  const [loadingText, setLoadingText] = useState('正在创建出题任务...')
  const [dockVisible, setDockVisible] = useState(true)

  const [user, setUser] = useState<UserBrief | null>(() => getCachedUser())
  const [historyItems, setHistoryItems] = useState<QuizHistoryItem[]>(
    () => readSwrCache<QuizHistoryItem[]>('home_history') || [],
  )
  const [docs, setDocs] = useState<KnowledgeDocumentItem[]>(
    () => readSwrCache<KnowledgeDocumentItem[]>('home_docs') || [],
  )
  const [overview, setOverview] = useState<MasteryOverviewResponse | null>(() =>
    readSwrCache<MasteryOverviewResponse>('home_overview_all'),
  )
  const [dueReviews, setDueReviews] = useState<DueReviewsResponse>(
    () => readSwrCache<DueReviewsResponse>('home_due_all') || buildEmptyDueReviews(),
  )

  const loadData = useCallback(async (domainId?: number) => {
    await waitForLogin()
    const cached = getCachedUser()
    if (cached) setUser(cached)

    const ovKey = `home_overview_${domainId || 'all'}`
    const dueKey = `home_due_${domainId || 'all'}`
    const swrOv = readSwrCache<MasteryOverviewResponse>(ovKey)
    const swrDue = readSwrCache<DueReviewsResponse>(dueKey)
    if (swrOv) setOverview(swrOv)
    if (swrDue) setDueReviews(swrDue)

    const [profileRes, histRes, docsRes, masteryRes, dueRes] = await Promise.all([
      getUserProfile().catch(() => null),
      getQuizHistory(1, 5).catch(() => null),
      getKnowledgeDocuments().catch(() => null),
      getMasteryOverview(domainId),
      getDueReviews(15, { domainId }),
    ])

    if (profileRes) {
      const brief: UserBrief = {
        id: profileRes.id,
        nickname: profileRes.nickname,
        avatar_url: profileRes.avatar_url,
        total_xp: profileRes.total_xp,
        streak_days: profileRes.streak_days,
      }
      setUser(brief)
      setCachedUser(brief)
    }
    if (histRes) {
      setHistoryItems(histRes.items)
      writeSwrCache('home_history', histRes.items)
    }
    if (docsRes) {
      setDocs(docsRes.items)
      writeSwrCache('home_docs', docsRes.items)
    }
    if (masteryRes) {
      setOverview(masteryRes)
      writeSwrCache(ovKey, masteryRes)
    }
    if (dueRes) {
      setDueReviews(dueRes)
      writeSwrCache(dueKey, dueRes)
    }
  }, [])

  useEffect(() => {
    void loadData(selectedDomainId)
  }, [loadData, selectedDomainId])

  useDidShow(() => {
    setDockVisible(true)
    Taro.eventCenter.trigger('zx:tab-change', 'index')
    void loadData(selectedDomainId)
  })

  useDidHide(() => {
    setDockVisible(false)
  })

  const effectiveOverview = useMemo(
    () => overview ?? buildFallbackMasteryOverview(historyItems, docs),
    [overview, historyItems, docs],
  )

  const domains = effectiveOverview.domains || []

  const activeFocusDomain = useMemo(() => {
    if (selectedDomainId) {
      return domains.find((d) => d.domain_id === selectedDomainId) || effectiveOverview.focus_domain
    }
    return effectiveOverview.focus_domain
  }, [selectedDomainId, domains, effectiveOverview.focus_domain])

  const weekStrip = useMemo(
    () =>
      overview?.weekly_rhythm?.length === 7
        ? overview.weekly_rhythm
        : buildRealCalendarStrip(),
    [overview],
  )

  const dueCount = selectedDomainId
    ? dueReviews.total_due
    : dueReviews.total_due || effectiveOverview.due_review_total
  const streakDays = user?.streak_days ?? effectiveOverview.streak_days
  const recommendedNum = useMemo(
    () =>
      questionChoice === 'adaptive'
        ? computeRecommendedCount(selfRated, activeFocusDomain?.mastery_score)
        : questionChoice,
    [questionChoice, selfRated, activeFocusDomain?.mastery_score],
  )

  const readyDocs = useMemo(() => docs.filter((d) => d.status === 'ready'), [docs])

  const scopedReadyDocs = useMemo(() => {
    if (!selectedDomainId) return readyDocs
    const matched = readyDocs.filter((d) => d.domain_id === selectedDomainId)
    return matched.length > 0 ? matched : readyDocs
  }, [readyDocs, selectedDomainId])

  const selectedDocs = useMemo(
    () => readyDocs.filter((d) => selectedDocIds.includes(d.doc_id)),
    [readyDocs, selectedDocIds],
  )

  const scopedHistory = useMemo(() => {
    if (!selectedDomainId || !activeFocusDomain) return historyItems.slice(0, 2)
    const matched = historyItems.filter(
      (h) => h.domain_name && h.domain_name === activeFocusDomain.name,
    )
    return (matched.length > 0 ? matched : historyItems).slice(0, 2)
  }, [historyItems, selectedDomainId, activeFocusDomain])

  const toggleDocSelection = (docId: string) => {
    setSelectedDocIds((prev) =>
      prev.includes(docId) ? prev.filter((id) => id !== docId) : [...prev, docId].slice(-4),
    )
  }

  const handleSelectFocusDomain = (domainId?: number) => {
    setSelectedDomainId(domainId)
    setSelectedDocIds([])
  }

  const startQuizFlow = async (opts: {
    prompt: string
    referenceText?: string
    reviewCardIds?: number[]
    docIds?: string[]
    domainId?: number
  }) => {
    if (loading) return
    setLoading(true)
    setLoadingText('正在调度自适应出题任务...')

    try {
      const authed = await ensureLogin()
      if (!authed) {
        Taro.showToast({ title: '正在建立登录会话，请稍后重试', icon: 'none' })
        return
      }

      const { task_id } = await generateQuizAsync({
        user_input: opts.prompt,
        reference_text: opts.referenceText,
        question_count: recommendedNum,
        adaptive_mode: questionChoice === 'adaptive',
        self_rated_level: selfRated,
        doc_id: opts.docIds?.[0],
        doc_ids: opts.docIds && opts.docIds.length > 0 ? opts.docIds : undefined,
        domain_id: opts.domainId,
        enable_web_search: enableWebSearch,
        generate_images: generateImages,
        review_card_ids: opts.reviewCardIds,
      })

      setLoadingText(
        enableWebSearch ? '正在并行检索知识文档与实时网页...' : 'DeepSeek 正在按你的掌握画像组卷...',
      )

      const quizData = await pollQuizTask(task_id, (status, task) => {
        if (task?.stage_message) {
          setLoadingText(task.stage_message)
        } else if (status === 'running') {
          setLoadingText('AI 正在精准编排题目与解析...')
        }
      })

      if (quizData.image_notice) {
        Taro.showToast({ title: quizData.image_notice, icon: 'none', duration: 2800 })
      }

      invalidateSwrCache('home_')
      setActiveQuizSession(quizData, [])
      Taro.navigateTo({
        url: `/pages/quiz/index?quizId=${encodeURIComponent(quizData.quiz_id)}`,
      })
    } catch (err: any) {
      Taro.showToast({ title: err?.message || '生成失败，请稍后重试', icon: 'none' })
    } finally {
      setLoading(false)
      setLoadingText('正在创建出题任务...')
    }
  }

  const handleGenerate = () => {
    const trimmed = inputValue.trim()
    const refTrimmed = referenceText.trim()
    const docNames = selectedDocs.map((d) => `《${d.file_name}》`).join('、')

    const prompt =
      trimmed ||
      (selectedDocs.length > 0
        ? `请基于知识文档 ${docNames} 生成一套针对性自测`
        : refTrimmed
          ? `请基于我粘贴的参考学习资料提炼核心机制与易错点并生成自测`
          : '')

    if (!prompt) {
      Taro.showToast({ title: '请输入主题、粘贴资料或选用知识文档', icon: 'none' })
      return
    }
    void startQuizFlow({
      prompt,
      referenceText: refTrimmed || undefined,
      docIds: selectedDocs.map((d) => d.doc_id),
      domainId: activeFocusDomain?.domain_id,
    })
  }

  /** V2.1 秒开错题复习：<50ms 用本地已拉取题干与选项直接开刷，拒绝 25s 白等 */
  const handleDueCardTap = () => {
    if (dueReviews.items.length > 0) {
      const instantQuiz = buildInstantReviewQuiz(dueReviews.items, activeFocusDomain?.name)
      setActiveQuizSession(instantQuiz, [])
      Taro.navigateTo({
        url: `/pages/quiz/index?quizId=${encodeURIComponent(instantQuiz.quiz_id)}`,
      })
      return
    }
    Taro.switchTab({ url: '/pages/mastery/index' })
  }

  const handleFocusCardTap = () => {
    const name = activeFocusDomain?.name || 'RAG 架构'
    setInputValue(`针对「${name}」薄弱环生成一套自适应测验`)
  }

  const avatarInitial = user?.nickname?.[0] || '知'
  const dateObj = new Date()
  const dateLabel = `${dateObj.getMonth() + 1}月${dateObj.getDate()}日`

  return (
    <View className='index-page'>
      {/* 1. 顶部 Greet 栏 */}
      <View className='home-header'>
        <View
          className='home-greet zx-press'
          onClick={() => Taro.switchTab({ url: '/pages/profile/index' })}
        >
          {user?.avatar_url ? (
            <Image className='monogram-img' src={user.avatar_url} mode='aspectFill' />
          ) : (
            <View className='monogram-circle'>
              <Text>{avatarInitial}</Text>
            </View>
          )}
          <View className='greet-texts'>
            <Text className='greet-title'>继续精进，{user?.nickname || '同学'}</Text>
            <Text className='greet-sub'>
              {dateLabel} · 连续复习 {streakDays} 天
            </Text>
          </View>
        </View>

        <View
          className='header-curve-btn zx-press'
          onClick={() => Taro.switchTab({ url: '/pages/mastery/index' })}
        >
          <View className='mini-search-glyph'>
            <View className='msg-ring' />
            <View className='msg-stem' />
          </View>
        </View>
      </View>

      {/* 2. MOVEPOP 7 日节律条 */}
      <View className='week-strip'>
        {weekStrip.map((d, idx) => (
          <View key={`${d.date_num}-${idx}`} className={`day-pill ${d.is_today ? 'is-today' : ''}`}>
            <Text className='day-wk'>{d.day_label}</Text>
            <Text className='day-num'>{d.date_num}</Text>
          </View>
        ))}
      </View>

      {/* 2.5 专注知识域工作区切换条（解决多领域混杂问题） */}
      {domains.length > 0 && (
        <ScrollView scrollX enableFlex showScrollbar={false} className='domain-bar-scroll'>
          <View className='domain-bar'>
            <View
              className={`domain-chip zx-press ${!selectedDomainId ? 'is-on' : ''}`}
              onClick={() => handleSelectFocusDomain(undefined)}
            >
              <Text>全部系统</Text>
            </View>
            {domains.map((dom) => (
              <View
                key={dom.domain_id}
                className={`domain-chip zx-press ${selectedDomainId === dom.domain_id ? 'is-on' : ''}`}
                onClick={() =>
                  handleSelectFocusDomain(
                    selectedDomainId === dom.domain_id ? undefined : dom.domain_id,
                  )
                }
              >
                <Text>{dom.name}</Text>
                {dom.due_review_count > 0 && (
                  <View className='domain-due-badge'>
                    <Text>{dom.due_review_count}</Text>
                  </View>
                )}
              </View>
            ))}
          </View>
        </ScrollView>
      )}

      {/* 3. 双卡 Bento（奶油黄错题秒开回顾 + 雾天蓝当前专注域） */}
      <View className='bento-grid'>
        <View className='bento-tile is-butter zx-press' onClick={handleDueCardTap}>
          <View className='bento-top'>
            <View className='micro-tag'>
              <Text>DUE TODAY</Text>
            </View>
            <GeometricProp variant='cards' />
          </View>
          <View className='bento-bottom'>
            <Text className='bento-val'>
              {String(dueCount).padStart(2, '0')} {dueCount > 0 ? '待刷' : '清零'}
            </Text>
            <Text className='bento-sub'>
              {dueCount > 0 ? '秒开错题本 · 即时巩固' : '暂无到期 · 查看记忆曲线'}
            </Text>
          </View>
        </View>

        <View className='bento-tile is-sky zx-press' onClick={handleFocusCardTap}>
          <View className='bento-top'>
            <View className='micro-tag'>
              <Text>FOCUS DOMAIN</Text>
            </View>
            <GeometricProp variant='target' />
          </View>
          <View className='bento-bottom'>
            <Text className='bento-val is-domain'>{activeFocusDomain?.name || 'RAG 架构'}</Text>
            <Text className='bento-sub'>
              掌握 {Math.round(activeFocusDomain?.mastery_score ?? 74)}% · 建议{' '}
              {activeFocusDomain?.recommended_count ?? 6} 题
            </Text>
          </View>
        </View>
      </View>

      {/* 4. 方案 B 纯净白三源融合出题舱 */}
      <View className='composer-card'>
        <View className='composer-head'>
          <Text className='composer-kicker'>发起新测验</Text>
          <View className='composer-actions'>
            <View
              className={`ref-toggle-chip zx-press ${showReferenceInput || referenceText ? 'is-on' : ''}`}
              onClick={() => setShowReferenceInput((prev) => !prev)}
            >
              <Text>
                {referenceText.trim()
                  ? `✓ 已贴资料 ${referenceText.trim().length}字`
                  : showReferenceInput
                    ? '收起资料'
                    : '+ 粘贴资料'}
              </Text>
            </View>
            {selectedDocs.length > 0 && (
              <View
                className='selected-doc-chip zx-press'
                onClick={() => setSelectedDocIds([])}
              >
                <Text>📎 {selectedDocs.length} 份文档 ×</Text>
              </View>
            )}
          </View>
        </View>

        <Textarea
          className='composer-textarea'
          placeholder='输入学习主题，或结合粘贴笔记 / 知识文档 / 联网检索三源出题...'
          placeholderClass='composer-placeholder'
          value={inputValue}
          onInput={(e) => setInputValue(e.detail.value)}
          maxlength={500}
          autoHeight={false}
        />

        {showReferenceInput && (
          <View className='reference-drawer'>
            <Textarea
              className='reference-textarea'
              placeholder='粘贴你想考察的笔记原文、代码片段或课程讲义（最多 12000 字）...'
              placeholderClass='composer-placeholder'
              value={referenceText}
              onInput={(e) => setReferenceText(e.detail.value)}
              maxlength={12000}
            />
          </View>
        )}

        {/* 快捷词 + 多选口袋文档快速挂接 */}
        <View className='quick-row'>
          {QUICK_TOPICS.map((t) => (
            <View
              key={t}
              className='quick-chip zx-press'
              onClick={() => setInputValue(`请帮我检验「${t}」的核心机制与易错点`)}
            >
              <Text>{t}</Text>
            </View>
          ))}
          {scopedReadyDocs.slice(0, 3).map((doc) => {
            const isPicked = selectedDocIds.includes(doc.doc_id)
            const cleanName = doc.file_name.replace(/\.[^.]+$/, '')
            return (
              <View
                key={doc.doc_id}
                className={`quick-chip is-doc zx-press ${isPicked ? 'is-doc-on' : ''}`}
                onClick={() => toggleDocSelection(doc.doc_id)}
              >
                <Text className='quick-doc-txt'>
                  {isPicked ? '✓ ' : '📄 '}
                  {cleanName}
                </Text>
              </View>
            )
          })}
        </View>

        {/* 按键第一行：DeepSeek 胶囊组 + 题量读数 */}
        <View className='controls-row'>
          <View className='ds-group'>
            <View
              className={`ds-pill zx-press ${enableWebSearch ? 'is-active' : 'is-muted'}`}
              onClick={() => setEnableWebSearch((prev) => !prev)}
            >
              <View className='ds-globe'>
                <View className='dsg-meridian' />
                <View className='dsg-equator' />
              </View>
              <Text>智能搜索</Text>
            </View>

            <View
              className={`ds-pill zx-press ${generateImages ? 'is-active' : 'is-muted'}`}
              onClick={() => setGenerateImages((prev) => !prev)}
            >
              <View className='ds-pic'>
                <View className='dsp-dot' />
              </View>
              <Text>配图</Text>
            </View>
          </View>

          <Text className='mode-readout'>
            {questionChoice === 'adaptive' ? `推荐 ${recommendedNum} 题` : `${recommendedNum} 题模式`}
          </Text>
        </View>

        {/* 按键第二行：出题节奏 seg-bar */}
        <View className='seg-row'>
          <Text className='seg-label'>出题节奏</Text>
          <View className='seg-bar'>
            {COUNT_CHOICES.map((c) => (
              <View
                key={String(c.value)}
                className={`seg-item zx-press ${questionChoice === c.value ? 'is-on' : ''}`}
                onClick={() => setQuestionChoice(c.value)}
              >
                <Text>{c.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* 按键第三行：冷启动当前熟悉度 */}
        <View className='seg-row is-compact'>
          <Text className='seg-label'>当前熟悉度</Text>
          <View className='seg-bar'>
            {SELF_LEVELS.map((lv) => (
              <View
                key={lv.value}
                className={`seg-item zx-press ${selfRated === lv.value ? 'is-on' : ''}`}
                onClick={() => setSelfRated(lv.value)}
              >
                <Text>{lv.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* 黑曜石全圆角主行动按钮 */}
        <View
          className={`zx-btn-obsidian ${loading ? 'is-disabled' : ''}`}
          onClick={handleGenerate}
        >
          <Text>{loading ? '正在调度组卷...' : '开始自适应测验'}</Text>
          <Text>→</Text>
        </View>
      </View>

      {/* 5. 最近练习精简列表（支持专注域过滤） */}
      <View className='recent-head'>
        <Text className='recent-heading'>
          {selectedDomainId && activeFocusDomain ? `${activeFocusDomain.name} · 记录` : '最近记录'}
        </Text>
        <Text
          className='recent-more'
          onClick={() => Taro.switchTab({ url: '/pages/profile/index' })}
        >
          全部档案 ›
        </Text>
      </View>

      {scopedHistory.length === 0 ? (
        <View className='zx-card recent-empty'>
          <Text className='recent-empty-text'>暂无记录，输入上方主题或前往「口袋」传笔记开刷</Text>
        </View>
      ) : (
        <View className='recent-list'>
          {scopedHistory.map((item) => (
            <View
              key={item.quiz_id}
              className='zx-card recent-item zx-press'
              onClick={() =>
                Taro.navigateTo({
                  url: `/pages/report/index?quizId=${encodeURIComponent(item.quiz_id)}`,
                })
              }
            >
              <View className='recent-info'>
                <Text className='recent-title'>{item.title}</Text>
                <Text className='recent-meta'>
                  {item.created_at} · {item.question_count} 题
                </Text>
              </View>
              <View className='recent-acc'>
                <Text>{Math.round(item.accuracy)}%</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* 跨端 H5 悬浮黑曜石 Dock（Weapp 由 custom-tab-bar 接管） */}
      {process.env.TARO_ENV === 'h5' && dockVisible && <FloatingDock activeKey='index' />}

      {/* 异步阶段加载遮罩 */}
      {loading && (
        <View className='zx-loading-overlay'>
          <View className='zx-loading-modal'>
            <View className='zx-spinner' />
            <Text className='zx-loading-title'>AI 正在为你定制题组</Text>
            <Text className='zx-loading-sub'>{loadingText}</Text>
          </View>
        </View>
      )}
    </View>
  )
}
