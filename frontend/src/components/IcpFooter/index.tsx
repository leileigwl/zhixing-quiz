import './index.scss'

export const ICP_NUMBER = '浙ICP备2026102405号-1'
export const ICP_URL = 'https://beian.miit.gov.cn/'

interface IcpFooterProps {
  className?: string
}

/** 备案页脚（仅 H5 渲染；工信部要求网站页面底部展示备案号并链接到 beian.miit.gov.cn） */
export default function IcpFooter({ className = '' }: IcpFooterProps) {
  if (process.env.TARO_ENV !== 'h5') return null
  return (
    <footer className={`zx-icp ${className}`}>
      <a className='zx-icp-link' href={ICP_URL} target='_blank' rel='noopener noreferrer'>
        {ICP_NUMBER}
      </a>
    </footer>
  )
}
