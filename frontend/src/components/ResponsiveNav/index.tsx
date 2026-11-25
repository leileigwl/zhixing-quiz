import FloatingDock, { type DockTabKey } from '../FloatingDock'
import SideNav from '../SideNav'
import { useViewportTier } from '../../hooks/useViewportTier'
import { usesSideNav } from '../../utils/viewport'

interface ResponsiveNavProps {
  activeKey: DockTabKey
}

/**
 * V2.9：H5 下按视口切换导航。
 * - 手机 <768 与 iPad 竖屏 768–1099：底部黑曜石 Dock（竖屏只把内容加宽居中，不把导航放左边）
 * - 宽屏 ≥1100：左侧 232px 侧栏
 * weapp 由 custom-tab-bar 负责，tab 页只在 H5 渲染本组件。
 */
export default function ResponsiveNav({ activeKey }: ResponsiveNavProps) {
  const tier = useViewportTier()
  if (usesSideNav(tier)) return <SideNav activeKey={activeKey} />
  return <FloatingDock activeKey={activeKey} />
}
