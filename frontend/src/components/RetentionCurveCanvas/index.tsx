import { useEffect } from 'react'
import { View, Canvas } from '@tarojs/components'
import Taro from '@tarojs/taro'
import type { RetentionCurvePoint } from '../../services/api'
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
  const safePoints =
    points.length >= 2
      ? points
      : [
          { day_label: '上次巩固', retention_pct: 84, baseline_pct: 84 },
          { day_label: '测前遗忘', retention_pct: 52, baseline_pct: 52, is_today: true },
          { day_label: '本次巩固', retention_pct: 86, baseline_pct: 42, is_recovery: true },
          { day_label: '+14天', retention_pct: 64, baseline_pct: 22 },
        ]

  ctx.clearRect(0, 0, width, height)

  const padL = 16
  const padR = 16
  const padT = 24
  const padB = 22
  const chartW = Math.max(40, width - padL - padR)
  const chartH = Math.max(40, height - padT - padB)

  const toY = (pct: number) => padT + ((100 - Math.max(10, Math.min(100, pct))) / 90) * chartH
  const toX = (idx: number) =>
    padL + (safePoints.length === 1 ? chartW / 2 : (idx / (safePoints.length - 1)) * chartW)

  ctx.save()

  // 顶部 100% 浅灰基线
  ctx.strokeStyle = 'rgba(20, 21, 26, 0.06)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(padL, toY(100))
  ctx.lineTo(width - padR, toY(100))
  ctx.stroke()

  // 50% 临界警戒虚线
  const y50 = toY(50)
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
  ctx.fillText('50% 警戒', padL + 2, y50 - 5)

  // 下层：未巩固自然遗忘对照虚线（仅当存在 baseline_pct 且分叉后绘制）
  const hasBaseline = safePoints.some((p) => typeof p.baseline_pct === 'number')
  if (hasBaseline) {
    ctx.setLineDash([3, 3])
    ctx.strokeStyle = 'rgba(20, 21, 26, 0.30)'
    ctx.lineWidth = 1.8
    ctx.beginPath()
    safePoints.forEach((pt, i) => {
      const x = toX(i)
      const y = toY(typeof pt.baseline_pct === 'number' ? pt.baseline_pct : pt.retention_pct)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()
    ctx.setLineDash([])
  }

  // 上层：本次巩固/当前稳定曲线 + 柔雾蓝面积填充
  const recoveryIdx = safePoints.findIndex((p) => p.is_recovery)
  const todayIdx = safePoints.findIndex((p) => p.is_today)
  const activeStart = todayIdx >= 0 ? todayIdx : recoveryIdx > 0 ? recoveryIdx - 1 : 0

  const grad = ctx.createLinearGradient(0, padT, 0, height - padB)
  grad.addColorStop(0, 'rgba(37, 99, 235, 0.20)')
  grad.addColorStop(1, 'rgba(37, 99, 235, 0.0)')

  ctx.beginPath()
  for (let i = activeStart; i < safePoints.length; i++) {
    const x = toX(i)
    const y = toY(safePoints[i].retention_pct)
    if (i === activeStart) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.lineTo(toX(safePoints.length - 1), height - padB)
  ctx.lineTo(toX(activeStart), height - padB)
  ctx.closePath()
  ctx.fillStyle = grad
  ctx.fill()

  ctx.strokeStyle = '#18191e'
  ctx.lineWidth = 2.4
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  for (let i = 0; i < safePoints.length; i++) {
    const x = toX(i)
    const y = toY(safePoints[i].retention_pct)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()

  // 关键锚点与真实数值/增益标注
  safePoints.forEach((pt, idx) => {
    const x = toX(idx)
    const y = toY(pt.retention_pct)
    if (pt.is_today) {
      ctx.fillStyle = '#d8685a'
      ctx.beginPath()
      ctx.arc(x, y, 4, 0, Math.PI * 2)
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

      const prePt = todayIdx >= 0 ? safePoints[todayIdx] : null
      const delta = prePt ? Math.round(pt.retention_pct - prePt.retention_pct) : 0
      const labelTxt =
        delta > 0 ? `巩固 ${Math.round(pt.retention_pct)}% (+${delta}%)` : `保持 ${Math.round(pt.retention_pct)}%`
      ctx.fillStyle = '#2563eb'
      ctx.font = '700 10px "PingFang SC", sans-serif'
      ctx.fillText(labelTxt, Math.min(x + 6, width - 102), Math.max(12, y - 9))
    }
  })

  // X 轴标签
  ctx.fillStyle = '#969aa6'
  ctx.font = '500 9.5px "PingFang SC", sans-serif'
  const firstLabel = safePoints[0].day_label
  const lastLabel = safePoints[safePoints.length - 1].day_label
  ctx.fillText(firstLabel, padL, height - 5)
  const midIdx = recoveryIdx >= 0 ? recoveryIdx : Math.floor(safePoints.length / 2)
  ctx.fillText(safePoints[midIdx].day_label, Math.max(padL + 42, toX(midIdx) - 18), height - 5)
  ctx.fillText(lastLabel, Math.max(padL + 96, width - padR - lastLabel.length * 9), height - 5)

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

    const timer = setTimeout(() => {
      if (cancelled) return
      const dpr = Taro.getSystemInfoSync?.().pixelRatio || 2

      if (process.env.TARO_ENV === 'h5' && typeof document !== 'undefined') {
        const wrapper = document.getElementById(canvasId)
        const canvasEl = (
          wrapper?.tagName === 'CANVAS' ? wrapper : wrapper?.querySelector('canvas')
        ) as HTMLCanvasElement | null
        if (!canvasEl) return
        const rect = canvasEl.getBoundingClientRect()
        const width = Math.max(260, rect.width || wrapper?.clientWidth || 300)
        const height = Math.max(110, rect.height || wrapper?.clientHeight || 126)
        canvasEl.width = Math.round(width * dpr)
        canvasEl.height = Math.round(height * dpr)
        const ctx = canvasEl.getContext('2d')
        if (!ctx) return
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        drawRetentionChart(ctx, width, height, points)
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
    }
  }, [canvasId, points])

  return (
    <View className='zx-curve-wrap'>
      <Canvas id={canvasId} canvasId={canvasId} type='2d' className='zx-curve-canvas' />
    </View>
  )
}
