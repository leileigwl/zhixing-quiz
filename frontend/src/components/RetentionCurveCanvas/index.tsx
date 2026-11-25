import { useEffect } from 'react'
import { View, Canvas } from '@tarojs/components'
import Taro from '@tarojs/taro'
import type { RetentionCurvePoint } from '../../services/api'
import { CHART_PADDING, prepareRetentionChart } from './chartModel'
import './index.scss'

interface RetentionCurveCanvasProps {
  canvasId: string
  points: RetentionCurvePoint[]
}

function drawRetentionChart(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  points: RetentionCurvePoint[],
) {
  const model = prepareRetentionChart(points, width, height)
  const { layout, activeStart } = model
  const padL = CHART_PADDING.left
  const padR = CHART_PADDING.right
  const padT = CHART_PADDING.top
  const padB = CHART_PADDING.bottom

  ctx.clearRect(0, 0, width, height)
  ctx.save()

  // 顶部 100% 浅灰基线
  ctx.strokeStyle = 'rgba(20, 21, 26, 0.06)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(padL, model.y100)
  ctx.lineTo(width - padR, model.y100)
  ctx.stroke()

  // 50% 临界警戒虚线
  const y50 = model.y50
  ctx.setLineDash([4, 4])
  ctx.strokeStyle = '#d8685a'
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.moveTo(padL, y50)
  ctx.lineTo(width - padR, y50)
  ctx.stroke()
  ctx.setLineDash([])

  ctx.fillStyle = '#c94c3d'
  ctx.font = '600 10px "PingFang SC", sans-serif'
  ctx.fillText('50% 警戒', Math.max(padL, width - padR - 46), y50 - 5)

  // 下层：未巩固自然遗忘对照虚线（仅当存在 baseline_pct 且分叉后绘制）
  if (model.hasBaseline) {
    ctx.setLineDash([3, 3])
    ctx.strokeStyle = 'rgba(20, 21, 26, 0.30)'
    ctx.lineWidth = 1.8
    ctx.beginPath()
    layout.forEach((pt, i) => {
      if (i === 0) ctx.moveTo(pt.x, pt.baselineY)
      else ctx.lineTo(pt.x, pt.baselineY)
    })
    ctx.stroke()
    ctx.setLineDash([])
  }

  // 上层：本次巩固/当前稳定曲线 + 柔雾蓝面积填充
  const grad = ctx.createLinearGradient(0, padT, 0, height - padB)
  grad.addColorStop(0, 'rgba(37, 99, 235, 0.20)')
  grad.addColorStop(1, 'rgba(37, 99, 235, 0.0)')

  ctx.beginPath()
  for (let i = activeStart; i < layout.length; i++) {
    if (i === activeStart) ctx.moveTo(layout[i].x, layout[i].y)
    else ctx.lineTo(layout[i].x, layout[i].y)
  }
  ctx.lineTo(layout[layout.length - 1].x, height - padB)
  ctx.lineTo(layout[activeStart].x, height - padB)
  ctx.closePath()
  ctx.fillStyle = grad
  ctx.fill()

  ctx.strokeStyle = '#18191e'
  ctx.lineWidth = 2.4
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  layout.forEach((pt, i) => {
    if (i === 0) ctx.moveTo(pt.x, pt.y)
    else ctx.lineTo(pt.x, pt.y)
  })
  ctx.stroke()

  // 关键锚点与真实数值/增益标注
  layout.forEach(({ x, y, point: pt }) => {
    if (pt.is_actual) {
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.arc(x, y, 4, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#18191e'
      ctx.lineWidth = 2
      ctx.stroke()

      ctx.fillStyle = '#525866'
      ctx.font = '600 9px "PingFang SC", sans-serif'
      ctx.fillText(`${Math.round(pt.retention_pct)}%`, Math.max(padL, x - 11), Math.max(12, y - 8))
    }
    if (pt.is_today) {
      ctx.fillStyle = '#d8685a'
      ctx.beginPath()
      ctx.arc(x, y, 4.2, 0, Math.PI * 2)
      ctx.fill()
    }
    if (pt.is_recovery) {
      ctx.fillStyle = '#2563eb'
      ctx.beginPath()
      ctx.arc(x, y, 4.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 1.5
      ctx.stroke()

      ctx.fillStyle = '#2563eb'
      ctx.font = '700 10px "PingFang SC", sans-serif'
      ctx.fillText(model.recoveryLabel || '', Math.min(x + 6, width - 108), Math.max(12, y - 9))
    }
  })

  // X 轴标签
  ctx.fillStyle = '#969aa6'
  ctx.font = '500 9.5px "PingFang SC", sans-serif'
  model.axisLabels.forEach((lbl) => ctx.fillText(lbl.text, lbl.x, height - 5))

  ctx.restore()
}

export default function RetentionCurveCanvas({ canvasId, points }: RetentionCurveCanvasProps) {
  useEffect(() => {
    let cancelled = false

    const renderWeapp = (attempt = 0) => {
      if (cancelled) return
      const query = Taro.createSelectorQuery()
      query
        .select(`#${canvasId}`)
        .fields({ node: true, size: true })
        .exec((res) => {
          if (cancelled) return
          const target = res?.[0]
          if (!target?.node) {
            if (attempt < 4) {
              setTimeout(() => renderWeapp(attempt + 1), 90)
            }
            return
          }
          const dpr = Taro.getSystemInfoSync?.().pixelRatio || 2
          const canvas = target.node
          const width = Math.max(240, target.width || 300)
          const height = Math.max(100, target.height || 126)
          canvas.width = Math.round(width * dpr)
          canvas.height = Math.round(height * dpr)
          const ctx = canvas.getContext('2d')
          if (!ctx) return
          ctx.setTransform?.(dpr, 0, 0, dpr, 0, 0)
          if (!ctx.setTransform) {
            ctx.scale(dpr, dpr)
          }
          drawRetentionChart(ctx, width, height, points)
        })
    }

    const renderH5 = (): boolean => {
      const dpr = Taro.getSystemInfoSync?.().pixelRatio || 2
      const wrapper = document.getElementById(canvasId)
      const canvasEl = (
        wrapper?.tagName === 'CANVAS' ? wrapper : wrapper?.querySelector('canvas')
      ) as HTMLCanvasElement | null
      if (!canvasEl) return false
      const rect = canvasEl.getBoundingClientRect()
      const width = Math.max(260, rect.width || wrapper?.clientWidth || 300)
      const height = Math.max(110, rect.height || wrapper?.clientHeight || 126)
      canvasEl.width = Math.round(width * dpr)
      canvasEl.height = Math.round(height * dpr)
      const ctx = canvasEl.getContext('2d')
      if (!ctx) return true
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      drawRetentionChart(ctx, width, height, points)
      return true
    }

    // V2.9：H5 下容器宽度变化（旋转 iPad、拖动窗口、跨断点换栏）时按新尺寸重绘；weapp 分支不变
    let observer: ResizeObserver | null = null
    let frame = 0
    const observeH5 = () => {
      if (typeof ResizeObserver === 'undefined') return
      const wrapper = document.getElementById(canvasId)
      if (!wrapper) return
      let lastWidth = Math.round(wrapper.getBoundingClientRect().width)
      observer = new ResizeObserver(() => {
        const w = Math.round(wrapper.getBoundingClientRect().width)
        if (w === lastWidth || w <= 0) return
        lastWidth = w
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(() => {
          if (!cancelled) renderH5()
        })
      })
      observer.observe(wrapper)
    }

    const timer = setTimeout(() => {
      if (cancelled) return

      if (process.env.TARO_ENV === 'h5' && typeof document !== 'undefined') {
        if (renderH5()) observeH5()
        return
      }

      if (typeof Taro.nextTick === 'function') {
        Taro.nextTick(() => renderWeapp(0))
      } else {
        renderWeapp(0)
      }
    }, 50)

    return () => {
      cancelled = true
      clearTimeout(timer)
      if (observer) observer.disconnect()
      if (frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
    }
  }, [canvasId, points])

  return (
    <View className='zx-curve-wrap'>
      <Canvas id={canvasId} canvasId={canvasId} type='2d' className='zx-curve-canvas' />
    </View>
  )
}
