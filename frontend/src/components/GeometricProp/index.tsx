import { View } from '@tarojs/components'
import './index.scss'

interface GeometricPropProps {
  variant: 'cards' | 'target'
}

/** 方案 B 软圆角层叠几何微缩图标（纯 CSS 图层，双端 100% 锐利且零 SVG 兼容隐患） */
export default function GeometricProp({ variant }: GeometricPropProps) {
  if (variant === 'cards') {
    return (
      <View className='geo-prop geo-cards'>
        <View className='gc-back' />
        <View className='gc-front'>
          <View className='gc-dot' />
          <View className='gc-line' />
        </View>
      </View>
    )
  }

  return (
    <View className='geo-prop geo-target'>
      <View className='gt-outer' />
      <View className='gt-inner'>
        <View className='gt-core' />
      </View>
    </View>
  )
}
