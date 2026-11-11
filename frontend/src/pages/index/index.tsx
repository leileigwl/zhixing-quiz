import { useState, useEffect, useCallback, useMemo } from 'react'
import { View, Text, Textarea, Image } from '@tarojs/components'
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
  buildRealCalendarStrip,
  computeRecommendedCount,
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
  const [enableWebSearch, setEnableWebSearch] = useState(true)
  const [generateImages, setGenerateImages] = useState(false)
  const [questionChoice, setQuestionChoice] = useState<QuestionCountChoice>('adaptive')
  const [selfRated, setSelfRated] = useState<SelfRatedLevel>('familiar')
  const [selectedDocId, setSelectedDocId] = useState<string | undefined>(undefined)

  const [loading, setLoading] = useState(false)
  const [loadingText, setLoadingText] = useState('正在创建出题任务...')
  const [dockVisible, setDockVisible] = useState(true)

  const [user, setUser] = useState<UserBrief | null>(null)
  const [historyItems, setHistoryItems] = useState<QuizHistoryItem[]>([])
  const [docs, setDocs] = useState<KnowledgeDocumentItem[]>([])
  const [overview, setOverview] = useState<MasteryOverviewResponse | null>(null)
  const [dueReviews, setDueReviews] = useState<DueReviewsResponse>(buildEmptyDueReviews())

  const loadData = useCallback(async () => {
    await waitForLogin()
    const cached = getCachedUser()
    if (cached) setUser(cached)

    const [profileRes, histRes, docsRes, masteryRes, dueRes] = await Promise.all([
      getUserProfile().catch(() => null),
      getQuizHistory(1, 3).catch(() => null),
      getKnowledgeDocuments().catch(() => null),
      getMasteryOverview(),
      getDueReviews(10),
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
    if (histRes) setHistoryItems(histRes.items)
    if (docsRes) setDocs(docsRes.items)
    if (masteryRes) setOverview(masteryRes)
    if (dueRes) setDueReviews(dueRes)
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  useDidShow(() => {
    setDockVisible(true)
    Taro.eventCenter.trigger('zx:tab-change', 'index')
    void loadData()
  })

  useDidHide(() => {
    setDockVisible(false)
  })

  const effectiveOverview = useMemo(
    () => overview ?? buildFallbackMasteryOverview(historyItems, docs),
    [overview, historyItems, docs],
  )

  const weekStrip = useMemo(
    () =>
      overview?.weekly_rhythm?.length === 7
        ? overview.weekly_rhythm
        : buildRealCalendarStrip(),
    [overview],
  )

  const focusDomain = effectiveOverview.focus_domain
  const dueCount = dueReviews.total_due || effectiveOverview.due_review_total
  const streakDays = user?.streak_days ?? effectiveOverview.streak_days
  const recommendedNum = useMemo(
    () =>
      questionChoice === 'adaptive'
        ? computeRecommendedCount(selfRated, focusDomain?.mastery_score)
        : questionChoice,
    [questionChoice, selfRated, focusDomain?.mastery_score],
  )

  const selectedDoc = useMemo(
    () => docs.find((d) => d.doc_id === selectedDocId && d.status === 'ready'),
    [docs, selectedDocId],
  )

  const readyDocs = useMemo(() => docs.filter((d) => d.status === 'ready'), [docs])

  const startQuizFlow = async (opts: {
    prompt: string
    reviewCardIds?: number[]
    docId?: string
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
        question_count: recommendedNum,
        adaptive_mode: questionChoice === 'adaptive',
        self_rated_level: selfRated,
        doc_id: opts.docId,
        domain_id: opts.domainId,
        enable_web_search: enableWebSearch,
        generate_images: generateImages,
        review_card_ids: opts.reviewCardIds,
      })

      setLoadingText(
        enableWebSearch ? 'LCEL 路由正在检索最新资料并组卷...' : 'DeepSeek 正在按你的掌握画像组卷...',
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
    const prompt =
      trimmed ||
      (selectedDoc
        ? `请基于我的知识口袋文档《${selectedDoc.file_name}》做一组针对性自测`
        : '')
    if (!prompt) {
      Taro.showToast({ title: '请先输入想自测的主题，或点击快捷词', icon: 'none' })
      return
    }
    void startQuizFlow({
      prompt,
      docId: selectedDoc?.doc_id,
      domainId: focusDomain?.domain_id,
    })
  }

  const handleDueCardTap = () => {
    if (dueReviews.items.length > 0) {
      const ids = dueReviews.items.slice(0, 6).map((c) => c.card_id)
      const topicNames = Array.from(new Set(dueReviews.items.map((c) => c.domain_name))).join('、')
      void startQuizFlow({
        prompt: `针对到期错题「${topicNames || '薄弱知识点'}」进行 SM-2 间隔巩固复习`,
        reviewCardIds: ids,
      })
      return
    }
    Taro.switchTab({ url: '/pages/mastery/index' })
  }

  const handleFocusCardTap = () => {
    const name = focusDomain?.name || 'RAG 架构'
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

      {/* 3. 双卡 Bento（奶油黄错题提醒 + 雾天蓝当前主攻域） */}
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
              {String(dueCount).padStart(2, '0')} {dueCount > 0 ? '错题' : '清零'}
            </Text>
            <Text className='bento-sub'>
              {dueCount > 0 ? 'SM-2 到期 · 点击复习' : '暂无到期 · 查看记忆曲线'}
            </Text>
          </View>
        </View>

        <View className='bento-tile is-sky zx-press' onClick={handleFocusCardTap}>
          <View className='bento-top'>
            <View className='micro-tag'>
              <Text>ADAPTIVE</Text>
            </View>
            <GeometricProp variant='target' />
          </View>
          <View className='bento-bottom'>
            <Text className='bento-val is-domain'>{focusDomain?.name || 'RAG 架构'}</Text>
            <Text className='bento-sub'>
              掌握 {Math.round(focusDomain?.mastery_score ?? 74)}% · 建议{' '}
              {focusDomain?.recommended_count ?? 6} 题
            </Text>
          </View>
        </View>
      </View>

      {/* 4. 方案 B 纯净白出题输入舱 */}
      <View className='composer-card'>
        <View className='composer-head'>
          <Text className='composer-kicker'>发起新测验</Text>
          {selectedDoc && (
            <View
              className='selected-doc-chip zx-press'
              onClick={() => setSelectedDocId(undefined)}
            >
              <Text>📎 {selectedDoc.file_name.slice(0, 12)} ×</Text>
            </View>
          )}
        </View>

        <Textarea
          className='composer-textarea'
          placeholder='输入知识主题，或下方一键选用知识口袋文档...'
          placeholderClass='composer-placeholder'
          value={inputValue}
          onInput={(e) => setInputValue(e.detail.value)}
          maxlength={500}
          autoHeight={false}
        />

        {/* 快捷词 + 口袋文档快速挂接 */}
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
          {readyDocs.slice(0, 1).map((doc) => (
            <View
              key={doc.doc_id}
              className={`quick-chip ${selectedDocId === doc.doc_id ? 'is-doc-on' : ''} zx-press`}
              onClick={() =>
                setSelectedDocId((prev) => (prev === doc.doc_id ? undefined : doc.doc_id))
              }
            >
              <Text>📄 {doc.file_name.replace(/\.[^.]+$/, '').slice(0, 10)}</Text>
            </View>
          ))}
        </View>

        {/* 按键第一行：DeepSeek 胶囊组 + 题量读数（禁止与 seg-bar 挤在一起折行） */}
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

      {/* 5. 最近练习精简列表（去 XP，只呈现时间与掌握度） */}
      <View className='recent-head'>
        <Text className='recent-heading'>最近记录</Text>
        <Text
          className='recent-more'
          onClick={() => Taro.switchTab({ url: '/pages/profile/index' })}
        >
          全部档案 ›
        </Text>
      </View>

      {historyItems.length === 0 ? (
        <View className='zx-card recent-empty'>
          <Text className='recent-empty-text'>暂无记录，输入上方主题或前往「口袋」传笔记开刷</Text>
        </View>
      ) : (
        <View className='recent-list'>
          {historyItems.slice(0, 2).map((item) => (
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
