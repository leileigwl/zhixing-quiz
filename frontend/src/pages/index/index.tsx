import { useState, useEffect, useCallback } from 'react'
import { View, Text, Textarea, Image } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import {
  ensureLogin,
  generateQuizAsync,
  pollQuizTask,
  getCachedUser,
  getUserProfile,
  setCachedUser,
  getQuizHistory,
  waitForLogin,
} from '../../services/api'
import type { UserBrief, QuizHistoryItem } from '../../services/api'
import { setActiveQuizSession } from '../../services/quizSessionStore'
import './index.scss'

const QUICK_TOPICS = ['RAG 检索', '计算机网络', '考研政治']

export default function IndexPage() {
  const [inputValue, setInputValue] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingText, setLoadingText] = useState('正在创建出题任务...')
  const [generateImages, setGenerateImages] = useState(false)
  const [user, setUser] = useState<UserBrief | null>(null)
  const [historyItems, setHistoryItems] = useState<QuizHistoryItem[]>([])

  const loadData = useCallback(async () => {
    await waitForLogin()
    const cached = getCachedUser()
    if (cached) setUser(cached)

    getUserProfile()
      .then((profile) => {
        const brief: UserBrief = {
          id: profile.id,
          nickname: profile.nickname,
          avatar_url: profile.avatar_url,
          total_xp: profile.total_xp,
        }
        setUser(brief)
        setCachedUser(brief)
      })
      .catch(() => {})

    getQuizHistory(1, 2)
      .then((res) => setHistoryItems(res.items))
      .catch(() => {})
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  useDidShow(() => {
    void loadData()
  })

  const handleSelectTopic = (topic: string) => {
    setInputValue(`我想重点复习「${topic}」的核心考点，请帮我生成一组闯关自测题并附上详细解析。`)
  }

  const handleGenerate = async () => {
    const trimmed = inputValue.trim()
    if (!trimmed) {
      Taro.showToast({ title: '请先输入想自测的主题或文本', icon: 'none' })
      return
    }
    if (loading) return

    setLoading(true)
    setLoadingText('正在创建出题任务...')
    try {
      const authed = await ensureLogin()
      if (!authed) {
        Taro.showToast({ title: '正在建立登录会话，请稍后重试', icon: 'none' })
        return
      }

      const { task_id } = await generateQuizAsync(trimmed, 5, undefined, generateImages)
      setLoadingText('AI 正在联网检索资料并生成题库...')

      const quizData = await pollQuizTask(task_id, (status) => {
        if (status === 'running') {
          setLoadingText('AI 正在编排题目与解析，请稍候...')
        }
      })

      if (quizData.image_notice) {
        Taro.showToast({ title: quizData.image_notice, icon: 'none', duration: 3000 })
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

  const handleOpenHistory = (quizId: string) => {
    Taro.navigateTo({
      url: `/pages/report/index?quizId=${encodeURIComponent(quizId)}`,
    })
  }

  const avatarInitial = user?.nickname?.[0] || '高'

  return (
    <View className='index-page'>
      {/* 顶部用户信息与 XP 徽章 */}
      <View className='home-header'>
        <View className='user-pill' onClick={() => Taro.switchTab({ url: '/pages/profile/index' })}>
          {user?.avatar_url ? (
            <Image className='avatar-img' src={user.avatar_url} mode='aspectFill' />
          ) : (
            <View className='avatar-fallback'>
              <Text>{avatarInitial}</Text>
            </View>
          )}
          <Text className='user-name'>{user?.nickname || '学习者'}</Text>
          <Text className='user-chevron'>⌄</Text>
        </View>
        <View className='xp-pill'>
          <Text className='xp-bolt'>⚡</Text>
          <Text className='xp-num'>{user?.total_xp ?? 0}</Text>
        </View>
      </View>

      {/* Hero 标题 */}
      <Text className='hero-title'>今天想自测什么？</Text>
      <Text className='hero-desc'>输入主题或知识点，AI 为你生成个性化题目</Text>

      {/* 多行输入卡片 */}
      <View className='input-card'>
        <Textarea
          className='prompt-textarea'
          placeholder='例如：RAG 原理、计算机网络、考研政治...'
          placeholderClass='prompt-placeholder'
          value={inputValue}
          onInput={(e) => setInputValue(e.detail.value)}
          maxlength={500}
          autoHeight={false}
        />
        <Text className='char-counter'>{inputValue.length}/500</Text>
      </View>

      {/* 快捷主题芯片 */}
      <View className='chips-row'>
        {QUICK_TOPICS.map((topic) => (
          <View key={topic} className='topic-chip' onClick={() => handleSelectTopic(topic)}>
            <Text>{topic}</Text>
          </View>
        ))}
      </View>

      {/* 配图开关 */}
      <View className='toggle-row' onClick={() => setGenerateImages((prev) => !prev)}>
        <Text className='toggle-label'>为题目生成配图</Text>
        <View className={`zx-switch ${generateImages ? 'is-on' : ''}`}>
          <View className='zx-switch-knob' />
        </View>
      </View>

      {/* 主行动按钮 */}
      <View
        className={`zx-btn-primary ${loading ? 'is-disabled' : ''}`}
        onClick={handleGenerate}
      >
        <Text>{loading ? loadingText : '⚡ 开始智能出题'}</Text>
      </View>

      {/* 最近闯关 */}
      <View className='section-head'>
        <Text className='section-title'>最近闯关</Text>
        <Text
          className='section-link'
          onClick={() => Taro.switchTab({ url: '/pages/profile/index' })}
        >
          全部记录 ›
        </Text>
      </View>

      {historyItems.length === 0 ? (
        <View className='zx-card empty-recent'>
          <Text className='empty-recent-text'>暂无闯关记录，输入上方主题或前往「知识库」传笔记出题</Text>
        </View>
      ) : (
        historyItems.map((item) => (
          <View
            key={item.quiz_id}
            className='zx-card recent-card'
            onClick={() => handleOpenHistory(item.quiz_id)}
          >
            <View className='recent-info'>
              <Text className='recent-title'>{item.title}</Text>
              <Text className='recent-time'>{item.created_at}</Text>
              <Text className='recent-meta'>共 {item.question_count} 题</Text>
            </View>
            <View className='badge-mastery'>
              <Text>{Math.round(item.accuracy)}% 掌握</Text>
            </View>
          </View>
        ))
      )}

      {/* 异步生成遮罩提示 */}
      {loading && (
        <View className='loading-overlay'>
          <View className='loading-modal'>
            <View className='loading-spinner' />
            <Text className='loading-title'>AI 正在为你出题</Text>
            <Text className='loading-sub'>{loadingText}</Text>
          </View>
        </View>
      )}
    </View>
  )
}
