import { View, Text } from '@tarojs/components'
import LineIcon from '../LineIcon'
import './index.scss'

interface OnboardingStepsProps {
  onUpload?: () => void
  onCompose?: () => void
  onCurve?: () => void
  title?: string
  className?: string
}

/**
 * V3.0 新用户三步引导（上传资料 → 出一组题 → 看记忆曲线）。
 * 每步右上角的小图是「示意」，明确标注，避免和真实数据混淆（2026-11-25 用户反馈：新用户不该看到假数据）。
 */
export default function OnboardingSteps({
  onUpload,
  onCompose,
  onCurve,
  title = '三步开始你的第一轮练习',
  className = '',
}: OnboardingStepsProps) {
  return (
    <View className={`zx-onb ${className}`}>
      <View className='zx-onb-head'>
        <Text className='zx-onb-title'>{title}</Text>
        <Text className='zx-onb-sub'>小图为示意，不是你的数据</Text>
      </View>
      <View className='zx-onb-steps'>
        <View className='zx-onb-step is-1 zx-press zx-hover-lift' onClick={onUpload}>
          <View className='zx-onb-top'>
            <Text className='zx-onb-no'>1</Text>
            <View className='zx-onb-art art-doc'>
              <Text className='zx-onb-tag'>示意</Text>
              <View className='doc-line is-w1' />
              <View className='doc-line is-w2' />
              <View className='doc-line is-w3' />
            </View>
          </View>
          <View className='zx-onb-texts'>
            <View className='zx-title-row'>
              <LineIcon name='upload' size={15} color='#3a2bb5' />
              <Text className='zx-onb-step-title'>上传资料</Text>
            </View>
            <Text className='zx-onb-step-desc'>PDF / Word / MD / TXT，或直接粘贴笔记</Text>
          </View>
        </View>

        <View className='zx-onb-step is-2 zx-press zx-hover-lift' onClick={onCompose}>
          <View className='zx-onb-top'>
            <Text className='zx-onb-no'>2</Text>
            <View className='zx-onb-art art-quiz'>
              <Text className='zx-onb-tag'>示意</Text>
              <View className='quiz-opt is-ok' />
              <View className='quiz-opt' />
              <View className='quiz-opt' />
            </View>
          </View>
          <View className='zx-onb-texts'>
            <View className='zx-title-row'>
              <LineIcon name='pen' size={15} color='#c2410c' />
              <Text className='zx-onb-step-title'>出一组题</Text>
            </View>
            <Text className='zx-onb-step-desc'>写个主题也行，3 题起，答完看解析</Text>
          </View>
        </View>

        <View className='zx-onb-step is-3 zx-press zx-hover-lift' onClick={onCurve}>
          <View className='zx-onb-top'>
            <Text className='zx-onb-no'>3</Text>
            <View className='zx-onb-art art-curve'>
              <Text className='zx-onb-tag'>示意</Text>
              <View className='curve-bar is-h1' />
              <View className='curve-bar is-h2' />
              <View className='curve-bar is-h3' />
              <View className='curve-bar is-h4' />
            </View>
          </View>
          <View className='zx-onb-texts'>
            <View className='zx-title-row'>
              <LineIcon name='chart' size={15} color='#047857' />
              <Text className='zx-onb-step-title'>看记忆曲线</Text>
            </View>
            <Text className='zx-onb-step-desc'>错题按遗忘曲线回来，掌握度随练随涨</Text>
          </View>
        </View>
      </View>
    </View>
  )
}
