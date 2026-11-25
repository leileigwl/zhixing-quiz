import { Image } from '@tarojs/components'
import { buildIconDataUri, type IconName } from './icons'
import './index.scss'

interface LineIconProps {
  name: IconName
  /** 像素尺寸（不随设计稿缩放） */
  size?: number
  color?: string
  className?: string
}

/** 卡片标题前的线性小图标（装饰性，读屏忽略） */
export default function LineIcon({ name, size = 16, color = '#18191e', className = '' }: LineIconProps) {
  const src = buildIconDataUri(name, color)
  const style = { width: `${size}px`, height: `${size}px` }
  // H5 用原生 <img>：Taro H5 的 <Image> 在 flex 容器内会按 mode 二次定位，小尺寸图标会被裁掉一半
  if (process.env.TARO_ENV === 'h5') {
    return <img className={`zx-line-icon ${className}`} src={src} style={style} alt='' aria-hidden='true' />
  }
  return <Image className={`zx-line-icon ${className}`} src={src} style={style} mode='aspectFit' />
}

export type { IconName }
