import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { View, Text, Textarea, Image } from '@tarojs/components'
import Taro, { useDidHide, useDidShow } from '@tarojs/taro'
import {
  getCachedUser,
  getUserProfile,
  setCachedUser,
  getKnowledgeDocuments,
  getMasteryOverview,
  getDueReviews,
  getKnowledgeDocumentStatus,
  uploadKnowledgeDocumentFromWebFile,
  waitForLogin,
  type UserBrief,
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
  computeRecommendedCount,
  domainHasPractice,
  hasPracticeData,
  readSwrCache,
  writeSwrCache,
} from '../../services/v2Adapters'
import {
  getBackgroundQuizState,
  startBackgroundQuizGeneration,
  subscribeBackgroundQuiz,
  type BackgroundQuizState,
} from '../../services/backgroundQuizManager'
import ResponsiveNav from '../../components/ResponsiveNav'
import IcpFooter from '../../components/IcpFooter'
import { FOCUS_COMPOSER_EVENT } from '../../components/SideNav'
import { setNavDueCount } from '../../components/SideNav/navBadge'
import BackgroundTaskPill from '../../components/BackgroundTaskPill'
import SevenDayRhythmBar from '../../components/SevenDayRhythmBar'
import { useEscClose } from '../../hooks/useEscClose'
import LineIcon from '../../components/LineIcon'
import { KB_ACCEPT, checkKnowledgeFile } from '../../services/knowledgeUpload'
import './index.scss'

const QUICK_TOPICS = ['RAG 检索', 'HTTP/3', '分布式锁']

const PRIMARY_COUNT_CHOICES: Array<{ value: 'fast3' | 'adaptive'; label: string }> = [
  { value: 'fast3', label: '快速 3题' },
  { value: 'adaptive', label: '智能推荐' },
]

const ALL_COUNT_CHOICES: Array<{ value: QuestionCountChoice; label: string }> = [
  { value: 3, label: '3题' },
  { value: 'adaptive', label: '智能推荐' },
  { value: 5, label: '5题' },
  { value: 10, label: '10题' },
]

const SELF_LEVELS: Array<{ value: SelfRatedLevel; label: string }> = [
  { value: 'unfamiliar', label: '陌生' },
  { value: 'familiar', label: '略懂' },
  { value: 'mastered', label: '熟练' },
]

const SELF_LABELS: Record<SelfRatedLevel, string> = {
  unfamiliar: '陌生',
  familiar: '略懂',
  mastered: '熟练',
}

export default function IndexPage() {
  const [inputValue, setInputValue] = useState('')
  const [referenceText, setReferenceText] = useState('')
  const [enableWebSearch, setEnableWebSearch] = useState(true)
  const [generateImages, setGenerateImages] = useState(false)
  const [questionChoice, setQuestionChoice] = useState<QuestionCountChoice>('adaptive')
  const [selfRated, setSelfRated] = useState<SelfRatedLevel>('familiar')
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([])
  const [selectedDomainId, setSelectedDomainId] = useState<number | undefined>(undefined)

  const [showMaterialSheet, setShowMaterialSheet] = useState(false)
  const [showSettingsSheet, setShowSettingsSheet] = useState(false)
  const [dockVisible, setDockVisible] = useState(true)
  const [composerFocus, setComposerFocus] = useState(false)
  const [refFocus, setRefFocus] = useState(false)
  const [sheetUploading, setSheetUploading] = useState(false)
  const sheetFileRef = useRef<HTMLInputElement | null>(null)
  const sheetPollTimers = useRef<Record<string, ReturnType<typeof setInterval>>>({})
  // V2.9：≥768 弹层变居中对话框；H5 下 Esc 关闭并管理焦点
  useEscClose(showMaterialSheet, () => setShowMaterialSheet(false), '.sheet-panel')
  useEscClose(showSettingsSheet, () => setShowSettingsSheet(false), '.sheet-panel')
  const [bgQuiz, setBgQuiz] = useState<BackgroundQuizState>(() => getBackgroundQuizState())

  const [user, setUser] = useState<UserBrief | null>(() => getCachedUser())
  const [docs, setDocs] = useState<KnowledgeDocumentItem[]>(
    () => readSwrCache<KnowledgeDocumentItem[]>('home_docs') || [],
  )
  const [overview, setOverview] = useState<MasteryOverviewResponse | null>(() =>
    readSwrCache<MasteryOverviewResponse>('home_overview_all'),
  )
  const [dueReviews, setDueReviews] = useState<DueReviewsResponse>(
    () => readSwrCache<DueReviewsResponse>('home_due_all') || buildEmptyDueReviews(),
  )
  const [quizCount, setQuizCount] = useState<number>(() => {
    const cached = getCachedUser() as any
    return typeof cached?.quiz_count === 'number' ? cached.quiz_count : (readSwrCache<MasteryOverviewResponse>('home_overview_all')?.focus_domain ? 1 : 0)
  })

  useEffect(() => subscribeBackgroundQuiz(setBgQuiz), [])

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

    const [profileRes, docsRes, masteryRes, dueRes] = await Promise.all([
      getUserProfile().catch(() => null),
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
      setQuizCount(profileRes.quiz_count ?? 0)
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
    () => overview ?? buildFallbackMasteryOverview([], docs),
    [overview, docs],
  )

  const domains = effectiveOverview.domains || []
  const activeFocusDomain = useMemo(() => {
    if (selectedDomainId) {
      return domains.find((d) => d.domain_id === selectedDomainId) || effectiveOverview.focus_domain
    }
    return effectiveOverview.focus_domain
  }, [selectedDomainId, domains, effectiveOverview.focus_domain])

  const dueCount = selectedDomainId
    ? (dueReviews.total_due ?? 0)
    : (dueReviews.total_due ?? effectiveOverview.due_review_total ?? 0)
  // 宽屏侧栏「今日」徽标：只同步「全部域」的待巩固总数
  useEffect(() => {
    if (!selectedDomainId) setNavDueCount(dueCount)
  }, [dueCount, selectedDomainId])

  // 宽屏侧栏「+ 发起新测验」：聚焦输入舱
  useEffect(() => {
    const onFocus = () => {
      setComposerFocus(false)
      setTimeout(() => setComposerFocus(true), 0)
    }
    Taro.eventCenter.on(FOCUS_COMPOSER_EVENT, onFocus)
    return () => {
      Taro.eventCenter.off(FOCUS_COMPOSER_EVENT, onFocus)
    }
  }, [])

  const streakDays = user?.streak_days ?? effectiveOverview.streak_days ?? 0
  const hasData = hasPracticeData(effectiveOverview)
  const focusHasPractice = domainHasPractice(activeFocusDomain)
  const todayCompleted = useMemo(() => {
    const todayBar = effectiveOverview.weekly_rhythm?.find((d) => d.is_today)
    return todayBar?.completed_count || 0
  }, [effectiveOverview.weekly_rhythm])

  const weekTotal = useMemo(
    () => (effectiveOverview.weekly_rhythm || []).reduce((sum, d) => sum + (d.completed_count || 0), 0),
    [effectiveOverview.weekly_rhythm],
  )

  const isColdStart = useMemo(() => {
    if (quizCount === 0 && dueCount === 0) return true
    if (!hasData && dueCount === 0) return true
    if (!overview?.focus_domain && (!effectiveOverview.domains || effectiveOverview.domains.length === 0)) {
      return true
    }
    return false
  }, [quizCount, dueCount, hasData, overview?.focus_domain, effectiveOverview.domains])

  const recommendedNum = useMemo(
    () =>
      questionChoice === 'adaptive'
        ? computeRecommendedCount(selfRated, focusHasPractice ? activeFocusDomain?.mastery_score : undefined)
        : questionChoice,
    [questionChoice, selfRated, focusHasPractice, activeFocusDomain?.mastery_score],
  )

  const readyDocs = useMemo(() => docs.filter((d) => d.status === 'ready'), [docs])
  const selectedDocs = useMemo(
    () => readyDocs.filter((d) => selectedDocIds.includes(d.doc_id)),
    [readyDocs, selectedDocIds],
  )

  const toggleDocSelection = (docId: string) => {
    setSelectedDocIds((prev) =>
      prev.includes(docId) ? prev.filter((id) => id !== docId) : [...prev, docId].slice(-4),
    )
  }

  const handleGenerate = () => {
    if (bgQuiz.status === 'running') {
      Taro.showToast({ title: '上一组题正在生成中，请稍候', icon: 'none' })
      return
    }
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
      Taro.showToast({ title: '请输入主题，或点「+ 资料/文档」引入素材', icon: 'none' })
      return
    }

    const displayTopic =
      trimmed ||
      (selectedDocs[0]?.file_name.replace(/\.[^.]+$/, '') || '') ||
      '学习材料精炼自测'

    void startBackgroundQuizGeneration({
      user_input: prompt,
      reference_text: refTrimmed || undefined,
      question_count: recommendedNum,
      adaptive_mode: questionChoice === 'adaptive',
      self_rated_level: selfRated,
      doc_id: selectedDocs[0]?.doc_id,
      doc_ids: selectedDocs.length > 0 ? selectedDocs.map((d) => d.doc_id) : undefined,
      domain_id: selectedDomainId,
      enable_web_search: enableWebSearch,
      generate_images: generateImages,
      displayTopic,
      originTag: 'home-custom',
      initiatedRoute: 'pages/index/index',
    })
  }

  /** 打开「导入参考资料」弹层并直接聚焦粘贴框：新用户点卡片就能填资料 / 传文件，而不是只看到提示 */
  const openMaterialSheet = () => {
    setShowMaterialSheet(true)
    setRefFocus(false)
    setTimeout(() => setRefFocus(true), 60)
  }

  /** 聚焦「发起新测验」输入框（滚动到可见处） */
  const focusComposer = () => {
    setComposerFocus(false)
    setTimeout(() => setComposerFocus(true), 0)
    if (process.env.TARO_ENV === 'h5' && typeof document !== 'undefined') {
      document.querySelector('.composer-card')?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
    }
  }

  /** 右侧攻坚卡：新用户直接打开资料导入；老用户优先 0.1s 命中预热题库或后台组卷 */
  const handleFocusTileTap = () => {
    if (isColdStart) {
      openMaterialSheet()
      return
    }
    const dom = activeFocusDomain
    if (!dom) {
      Taro.switchTab({ url: '/pages/mastery/index' })
      return
    }
    if (bgQuiz.status === 'running') {
      Taro.showToast({ title: '题目正在后台生成中', icon: 'none' })
      return
    }
    void startBackgroundQuizGeneration({
      user_input: `针对「${dom.name}」核心重难点与常见误区生成自适应巩固测验`,
      question_count: dom.recommended_count || 4,
      adaptive_mode: true,
      domain_id: dom.domain_id,
      enable_web_search: false,
      allow_prewarm: true,
      displayTopic: `${dom.name} · ${dom.recommended_count || 4}题`,
      originTag: 'home-focus',
      initiatedRoute: 'pages/index/index',
    })
  }

  const handleDueCardTap = () => {
    if (dueReviews.items.length > 0) {
      const instantQuiz = buildInstantReviewQuiz(dueReviews.items, activeFocusDomain?.name)
      setActiveQuizSession(instantQuiz, [])
      Taro.navigateTo({
        url: `/pages/quiz/index?quizId=${encodeURIComponent(instantQuiz.quiz_id)}`,
      })
      return
    }
    // 还没答过题：没有曲线可看，直接带去出题
    if (isColdStart) {
      focusComposer()
      return
    }
    Taro.switchTab({ url: '/pages/mastery/index' })
  }

  /* ---------- 弹层内直接上传文档（H5）：选完立即上传，解析就绪后自动勾选 ---------- */
  useEffect(() => {
    const timers = sheetPollTimers.current
    return () => Object.values(timers).forEach((t) => clearInterval(t))
  }, [])

  const pollSheetDoc = (docId: string) => {
    let attempts = 0
    const timer = setInterval(async () => {
      attempts += 1
      try {
        const st = await getKnowledgeDocumentStatus(docId)
        setDocs((prev) =>
          prev.map((d) =>
            d.doc_id === docId
              ? { ...d, status: st.status, chunk_count: st.chunk_count, domain_name: st.domain_name ?? d.domain_name }
              : d,
          ),
        )
        if (st.status === 'ready') {
          setSelectedDocIds((prev) => (prev.includes(docId) ? prev : [...prev, docId].slice(-4)))
        }
        if (st.status === 'ready' || st.status === 'failed' || attempts >= 40) {
          clearInterval(timer)
          delete sheetPollTimers.current[docId]
        }
      } catch {
        clearInterval(timer)
        delete sheetPollTimers.current[docId]
      }
    }, 3000)
    sheetPollTimers.current[docId] = timer
  }

  const handleSheetUploadClick = () => {
    if (sheetUploading) return
    if (process.env.TARO_ENV === 'h5') {
      sheetFileRef.current?.click()
      return
    }
    setShowMaterialSheet(false)
    Taro.switchTab({ url: '/pages/knowledge/index' })
  }

  const handleSheetFile = async (e: any) => {
    const file: File | undefined = e?.target?.files?.[0]
    if (e?.target) e.target.value = ''
    if (!file || sheetUploading) return
    const check = checkKnowledgeFile(file.name, file.size)
    if (!check.ok) {
      Taro.showToast({ title: check.message, icon: 'none' })
      return
    }
    setSheetUploading(true)
    try {
      const res = await uploadKnowledgeDocumentFromWebFile(file)
      setDocs((prev) => [
        {
          doc_id: res.doc_id,
          file_name: res.file_name,
          file_type: check.ext,
          file_size: file.size,
          status: 'processing',
          chunk_count: 0,
          domain_name: res.domain_name,
          error_message: null,
          created_at: new Date().toISOString(),
        },
        ...prev,
      ])
      Taro.showToast({ title: '已上传，解析完成后自动选用', icon: 'none' })
      pollSheetDoc(res.doc_id)
    } catch (err: any) {
      Taro.showToast({ title: err?.message || '上传失败，请稍后重试', icon: 'none' })
    } finally {
      setSheetUploading(false)
    }
  }

  const processingDocs = docs.filter((d) => d.status === 'processing')

  const avatarInitial = user?.nickname?.[0] || '知'
  const materialCount = (referenceText.trim() ? 1 : 0) + selectedDocs.length
  const isCustomRunning = bgQuiz.status === 'running' && bgQuiz.originTag === 'home-custom'
  const isFocusRunning = bgQuiz.status === 'running' && bgQuiz.originTag === 'home-focus'
  const showHomePill =
    bgQuiz.status !== 'idle' &&
    (bgQuiz.status !== 'running' || (!isCustomRunning && !isFocusRunning))
  const primaryCountKey: 'fast3' | 'adaptive' = questionChoice === 3 ? 'fast3' : 'adaptive'

  return (
    <View className={`index-page zx-rpage zx-with-sidenav ${showHomePill ? 'has-bg-pill' : ''}`}>
      {/* 1. 顶部紧致状态栏（防右侧小屏裁切） */}
      <View className='home-topbar'>
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
            <Text className='greet-title'>
              {isColdStart && (!user?.nickname || user.nickname === '学习者' || user.nickname === '同学')
                ? '欢迎开启，新同学'
                : `继续精进，${user?.nickname || '同学'}`}
            </Text>
            <Text className='greet-sub'>
              连续 {streakDays} 天 · 今日已练 {todayCompleted} 题
            </Text>
          </View>
        </View>

        <View
          className='topbar-badge zx-press'
          onClick={() => Taro.switchTab({ url: '/pages/mastery/index' })}
        >
          <Text>曲线日程 ›</Text>
        </View>
      </View>

      <View className='home-grid'>
      {/* 2. 紧致双快捷区（纯正中文、冷启动引导与薄弱攻坚一键开刷） */}
      <View className='mini-bento-grid'>
        <View className='mini-tile is-butter zx-press zx-hover-lift' onClick={handleDueCardTap}>
          <View className='mini-top'>
            <View className='mini-tag-row'>
              <LineIcon name='refresh' size={14} />
              <Text className='mini-tag'>今日待巩固</Text>
            </View>
            <Text className='mini-arrow'>→</Text>
          </View>
          <View className='mini-bottom'>
            <Text className='mini-val'>
              {String(dueCount).padStart(2, '0')} {dueCount > 0 ? '待巩固' : '已清零'}
            </Text>
            <Text className='mini-sub'>
              {dueCount > 0 ? '秒开错题回忆' : isColdStart ? '答错的题会自动进这里 · 去出题' : '暂无到期 · 查看曲线'}
            </Text>
          </View>
        </View>

        <View
          className={`mini-tile ${isColdStart ? 'is-sky-cold' : 'is-sky'} zx-press zx-hover-lift`}
          onClick={handleFocusTileTap}
        >
          <View className='mini-top'>
            <View className='mini-tag-row'>
              <LineIcon name='target' size={14} />
              <Text className='mini-tag'>{isColdStart ? '待解锁攻坚' : '重点攻坚'}</Text>
            </View>
            <Text className='mini-arrow'>{isFocusRunning ? '···' : '›'}</Text>
          </View>
          <View className='mini-bottom'>
            <Text className='mini-val is-domain'>
              {isColdStart ? '待首测定位' : (activeFocusDomain?.name || '综合知识域')}
            </Text>
            <Text className='mini-sub'>
              {isColdStart
                ? '上传资料或粘贴笔记 · 点此导入'
                : isFocusRunning
                  ? `生成中 (${bgQuiz.elapsedSec}s)...`
                  : focusHasPractice
                    ? `掌握 ${Math.round(activeFocusDomain?.mastery_score ?? 0)}% · 一键开刷 ${activeFocusDomain?.recommended_count ?? 4} 题`
                    : `未练习 · 一键开刷 ${activeFocusDomain?.recommended_count ?? 4} 题`}
            </Text>
          </View>
        </View>
      </View>

      {/* 3. 核心「发起新测验」主卡（保留三源快速导入与极简选项） */}
      <View className='composer-card'>
        <View className='composer-head'>
          <View className='composer-title-wrap'>
            <LineIcon name='pen' size={15} />
            <Text className='composer-kicker'>发起新测验</Text>
            {selectedDomainId && activeFocusDomain && (
              <Text className='composer-domain-tag'>· {activeFocusDomain.name}</Text>
            )}
          </View>

          <View className='composer-tools'>
            <View
              className={`tool-chip zx-press ${materialCount > 0 ? 'is-on' : ''}`}
              onClick={() => setShowMaterialSheet(true)}
            >
              <Text>{materialCount > 0 ? `资料 ×${materialCount}` : '+ 资料/文档'}</Text>
            </View>
            <View
              className='tool-chip zx-press'
              onClick={() => setShowSettingsSheet(true)}
            >
              <Text>
                ⚙ {SELF_LABELS[selfRated]}
                {generateImages ? '·配图' : ''}
              </Text>
            </View>
          </View>
        </View>

        <Textarea
          className='composer-textarea'
          placeholder='输入想检验的知识主题，或点右上角导入资料/文档...'
          placeholderClass='composer-placeholder'
          value={inputValue}
          onInput={(e) => setInputValue(e.detail.value)}
          focus={composerFocus}
          onBlur={() => setComposerFocus(false)}
          maxlength={500}
          autoHeight={false}
        />

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
        </View>

        <View className='controls-row'>
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

          <View className='seg-bar'>
            {PRIMARY_COUNT_CHOICES.map((c) => {
              const isOn =
                questionChoice === 'adaptive'
                  ? c.value === 'adaptive'
                  : questionChoice === 3
                    ? c.value === 'fast3'
                    : c.value === primaryCountKey
              return (
                <View
                  key={c.value}
                  className={`seg-item zx-press ${isOn ? 'is-on' : ''}`}
                  onClick={() =>
                    setQuestionChoice(c.value === 'fast3' ? 3 : 'adaptive')
                  }
                >
                  <Text>
                    {c.value === 'adaptive' && questionChoice !== 3 && questionChoice !== 'adaptive'
                      ? `已选 ${questionChoice}题`
                      : c.value === 'adaptive'
                        ? `智能推荐 ${recommendedNum}题`
                        : c.label}
                  </Text>
                </View>
              )
            })}
          </View>
        </View>

        <View
          className={`zx-btn-obsidian ${isCustomRunning ? 'is-running' : ''}`}
          onClick={handleGenerate}
        >
          {isCustomRunning ? (
            <View className='btn-inline-running'>
              <View className='inline-spinner' />
              <Text>出题中 ({bgQuiz.elapsedSec}s)</Text>
            </View>
          ) : (
            <>
              <Text>开始测验</Text>
              <Text>→</Text>
            </>
          )}
        </View>
      </View>

        {/* V2.9：iPad / 宽屏新增「本周完成题数」卡（手机端隐藏，保持现网） */}
        <View className='home-rhythm-card'>
          <View className='home-rhythm-head'>
            <View className='zx-title-row'>
              <LineIcon name='calendar' size={15} />
              <Text className='home-rhythm-title'>本周完成题数</Text>
            </View>
            <Text className='home-rhythm-sub'>共 {weekTotal} 题</Text>
          </View>
          <SevenDayRhythmBar days={effectiveOverview.weekly_rhythm || []} />
        </View>
      </View>

      {/* 抽屉 1：三源资料与文档多选半屏弹层 */}
      {showMaterialSheet && (
        <View className='sheet-mask' onClick={() => setShowMaterialSheet(false)}>
          <View className='sheet-panel' role='dialog' aria-modal='true' onClick={(e) => e.stopPropagation()}>
            <View className='sheet-head'>
              <Text className='sheet-title'>导入参考资料与知识文档</Text>
              <Text className='sheet-done' onClick={() => setShowMaterialSheet(false)}>
                完成
              </Text>
            </View>

            <Text className='sheet-label'>粘贴笔记原文 / 错题段落（最多 12000 字）</Text>
            <View className='sheet-textarea-box'>
              <Textarea
                className='sheet-textarea'
                placeholder='在此粘贴你想让 AI 重点考察的教材原文、代码片段或课程笔记...'
                placeholderClass='composer-placeholder'
                value={referenceText}
                onInput={(e) => setReferenceText(e.detail.value)}
                focus={refFocus}
                onBlur={() => setRefFocus(false)}
                maxlength={12000}
              />
            </View>

            <View className='sheet-doc-head'>
              <Text className='sheet-label'>选用口袋已解析文档（支持多选）</Text>
              <View className='sheet-upload-btn zx-press' onClick={handleSheetUploadClick}>
                <LineIcon name='upload' size={13} />
                <Text>{sheetUploading ? '上传中…' : '上传文件'}</Text>
              </View>
            </View>
            {process.env.TARO_ENV === 'h5' && (
              <input
                ref={sheetFileRef}
                type='file'
                accept={KB_ACCEPT}
                style={{ display: 'none' }}
                onChange={handleSheetFile}
              />
            )}
            {processingDocs.length > 0 && (
              <Text className='sheet-processing'>
                {processingDocs.map((d) => `《${d.file_name}》`).join('、')} 解析中，完成后自动勾选
              </Text>
            )}

            {readyDocs.length === 0 ? (
              <Text className='sheet-empty'>还没有文档。点右上角「上传文件」选 PDF / Word / MD / TXT，或直接在上面粘贴笔记</Text>
            ) : (
              <View className='sheet-doc-list'>
                {readyDocs.slice(0, 6).map((doc) => {
                  const picked = selectedDocIds.includes(doc.doc_id)
                  return (
                    <View
                      key={doc.doc_id}
                      className={`sheet-doc-row zx-press ${picked ? 'is-on' : ''}`}
                      onClick={() => toggleDocSelection(doc.doc_id)}
                    >
                      <View className='sheet-doc-info'>
                        <Text className='sheet-doc-name'>{doc.file_name}</Text>
                        <Text className='sheet-doc-meta'>
                          {doc.domain_name || '综合知识域'} · {doc.chunk_count || 1} 切片
                        </Text>
                      </View>
                      <View className={`sheet-check ${picked ? 'is-on' : ''}`}>
                        <Text>{picked ? '✓' : '+'}</Text>
                      </View>
                    </View>
                  )
                })}
              </View>
            )}
          </View>
        </View>
      )}

      {/* 抽屉 2：高级出题设置 */}
      {showSettingsSheet && (
        <View className='sheet-mask' onClick={() => setShowSettingsSheet(false)}>
          <View className='sheet-panel' role='dialog' aria-modal='true' onClick={(e) => e.stopPropagation()}>
            <View className='sheet-head'>
              <Text className='sheet-title'>出题偏好设置</Text>
              <Text className='sheet-done' onClick={() => setShowSettingsSheet(false)}>
                完成
              </Text>
            </View>

            {domains.length > 0 && (
              <View className='sheet-group'>
                <Text className='sheet-label'>限定知识域（影响曲线聚焦与错题过滤）</Text>
                <View className='sheet-pills'>
                  <View
                    className={`sheet-pill ${!selectedDomainId ? 'is-on' : ''}`}
                    onClick={() => setSelectedDomainId(undefined)}
                  >
                    <Text>全部域</Text>
                  </View>
                  {domains.map((dom) => (
                    <View
                      key={dom.domain_id}
                      className={`sheet-pill ${selectedDomainId === dom.domain_id ? 'is-on' : ''}`}
                      onClick={() => setSelectedDomainId(dom.domain_id)}
                    >
                      <Text>
                        {dom.name}
                        {dom.due_review_count > 0 ? ` (${dom.due_review_count})` : ''}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            <View className='sheet-group'>
              <Text className='sheet-label'>题量档位</Text>
              <View className='sheet-pills'>
                {ALL_COUNT_CHOICES.map((c) => (
                  <View
                    key={String(c.value)}
                    className={`sheet-pill ${questionChoice === c.value ? 'is-on' : ''}`}
                    onClick={() => setQuestionChoice(c.value)}
                  >
                    <Text>{c.label}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View className='sheet-group'>
              <Text className='sheet-label'>当前熟悉度自评</Text>
              <View className='sheet-pills'>
                {SELF_LEVELS.map((lv) => (
                  <View
                    key={lv.value}
                    className={`sheet-pill ${selfRated === lv.value ? 'is-on' : ''}`}
                    onClick={() => setSelfRated(lv.value)}
                  >
                    <Text>{lv.label}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View
              className={`sheet-switch-row zx-press ${generateImages ? 'is-on' : ''}`}
              onClick={() => setGenerateImages((prev) => !prev)}
            >
              <View>
                <Text className='sheet-switch-title'>AI 辅助概念配图</Text>
                <Text className='sheet-switch-sub'>后台异步绘制不阻塞作答</Text>
              </View>
              <View className={`sheet-toggle ${generateImages ? 'is-on' : ''}`}>
                <View className='sheet-knob' />
              </View>
            </View>
          </View>
        </View>
      )}

      <IcpFooter />

      <BackgroundTaskPill visible={dockVisible && showHomePill} />

      {process.env.TARO_ENV === 'h5' && dockVisible && <ResponsiveNav activeKey='index' />}
    </View>
  )
}
