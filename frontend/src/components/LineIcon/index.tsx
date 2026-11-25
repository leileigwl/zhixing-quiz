import { Image } from '@tarojs/components'
import { buildIconDataUri, type IconName } from './icons'
import './index.scss'

interface LineIconProps {
  name: IconName
  /** 像素尺寸（H5 用 Px，不随设计稿缩放） */
  size?: number
  color?: string
  className?: string
}

/** 卡片标题前的线性小图标（装饰性，读屏忽略） */
export default function LineIcon({ name, size = 16, color = '#18191e', className = '' }: LineIconProps) {
  return (
    <Image
      className={`zx-line-icon ${className}`}
      src={buildIconDataUri(name, color)}
      style={{ width: `${size}px`, height: `${size}px` }}
      mode='aspectFit'
      aria-hidden
    />
  )
}

export type { IconName }
