import { useEffect, useState } from 'react'
import { View, Text } from '@tarojs/components'
import {
  dismissBackgroundQuiz,
  getBackgroundQuizState,
  openReadyBackgroundQuiz,
  subscribeBackgroundQuiz,
  type BackgroundQuizState,
} from '../../services/backgroundQuizManager'
import './index.scss'

export default function BackgroundTaskPill({ visible = true }: { visible?: boolean }) {
  const [state, setState] = useState<BackgroundQuizState>(() => getBackgroundQuizState())

  useEffect(() => subscribeBackgroundQuiz(setState), [])

  if (!visible || state.status === 'idle') return null

  const handleMainTap = () => {
    if (state.status === 'completed') {
      openReadyBackgroundQuiz()
    } else if (state.status === 'failed') {
      dismissBackgroundQuiz()
    }
  }

  return (
    <View className='bg-pill-wrap'>
      <View
        className={`bg-pill is-${state.status} zx-press`}
        onClick={handleMainTap}
      >
        <View className='bg-pill-left'>
          {state.status === 'running' && <View className='bg-spinner' />}
          {state.status === 'completed' && <Text className='bg-badge-ok'>✓</Text>}
          {state.status === 'failed' && <Text className='bg-badge-err'>!</Text>}
          <View className='bg-pill-texts'>
            <Text className='bg-pill-title'>
              {state.status === 'running'
                ? `正在生成《${state.topic}》 (${state.elapsedSec}s)`
                : state.status === 'completed'
                  ? `《${state.topic}》已就绪 · 点击开始作答 →`
                  : `《${state.topic}》未生成`}
            </Text>
            <Text className='bg-pill-sub'>
              {state.stageMessage}
            </Text>
          </View>
        </View>

        {state.status !== 'running' && (
          <View
            className='bg-pill-close'
            onClick={(e) => {
              e.stopPropagation()
              dismissBackgroundQuiz()
            }}
          >
            <Text>×</Text>
          </View>
        )}
      </View>
    </View>
  )
}
