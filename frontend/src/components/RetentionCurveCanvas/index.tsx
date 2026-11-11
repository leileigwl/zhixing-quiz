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
          { day_label: 'D1', retention_pct: 90 },
          { day_label: '重测前', retention_pct: 46, is_today: true },
          { day_label: '今日巩固', retention_pct: 94, is_recovery: true },
          { day_label: '+14天', retention_pct: 80 },
        ]

  ctx.clearRect(0, 0, width, height)

  const padL = 14
  const padR = 14
  const padT = 22
  const padB = 22
  const chartW = Math.max(40, width - padL - padR)
  const chartH = Math.max(40, height - padT - padB)

  const toY = (pct: number) => padT + ((100 - Math.max(10, Math.min(100, pct))) / 90) * chartH
  const toX = (idx: number) =>
    padL + (safePoints.length === 1 ? chartW / 2 : (idx / (safePoints.length - 1)) * chartW)

  // Subtle top baseline (100%)
  ctx.save()
  ctx.strokeStyle = 'rgba(20, 21, 26, 0.06)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(padL, toY(100))
  ctx.lineTo(width - padR, toY(100))
  ctx.stroke()

  // 50% Critical Dashed Threshold
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
  ctx.fillText('50% 临界线', padL + 2, y50 - 5)

  // Find split between pre-review decay and today's recovery
  const recoveryIdx = safePoints.findIndex((p) => p.is_recovery)
  const splitIdx = recoveryIdx > 0 ? recoveryIdx : safePoints.length

  // Pre-review decay dashed path
  if (splitIdx >= 2) {
    ctx.setLineDash([3, 3])
    ctx.strokeStyle = 'rgba(20, 21, 26, 0.34)'
    ctx.lineWidth = 2
    ctx.beginPath()
    for (let i = 0; i < splitIdx; i++) {
      const x = toX(i)
      const y = toY(safePoints[i].retention_pct)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
    ctx.setLineDash([])
  }

  // Recovery curve with soft blue fill gradient
  const startCurve = splitIdx > 0 && splitIdx < safePoints.length ? splitIdx - 1 : 0
  const grad = ctx.createLinearGradient(0, padT, 0, height - padB)
  grad.addColorStop(0, 'rgba(37, 99, 235, 0.18)')
  grad.addColorStop(1, 'rgba(37, 99, 235, 0.0)')

  ctx.beginPath()
  for (let i = startCurve; i < safePoints.length; i++) {
    const x = toX(i)
    const y = toY(safePoints[i].retention_pct)
    if (i === startCurve) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.lineTo(toX(safePoints.length - 1), height - padB)
  ctx.lineTo(toX(startCurve), height - padB)
  ctx.closePath()
  ctx.fillStyle = grad
  ctx.fill()

  ctx.strokeStyle = '#18191e'
  ctx.lineWidth = 2.4
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  for (let i = startCurve; i < safePoints.length; i++) {
    const x = toX(i)
    const y = toY(safePoints[i].retention_pct)
    if (i === startCurve) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()

  // Key marker dots + labels
  safePoints.forEach((pt, idx) => {
    const x = toX(idx)
    const y = toY(pt.retention_pct)
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
      ctx.fillText(`回升 ${Math.round(pt.retention_pct)}%`, Math.min(x + 8, width - 68), Math.max(12, y - 8))
    }
  })

  // X-axis edge & center labels
  ctx.fillStyle = '#969aa6'
  ctx.font = '500 9.5px "PingFang SC", sans-serif'
  const firstLabel = safePoints[0].day_label
  const lastLabel = safePoints[safePoints.length - 1].day_label
  ctx.fillText(firstLabel, padL, height - 5)
  const midIdx = Math.floor(safePoints.length / 2)
  ctx.fillText(safePoints[midIdx].day_label, Math.max(padL + 36, toX(midIdx) - 16), height - 5)
  ctx.fillText(lastLabel, Math.max(padL + 80, width - padR - lastLabel.length * 9), height - 5)

  ctx.restore()
}

export default function RetentionCurveCanvas({ canvasId, points }: RetentionCurveCanvasProps) {
  useEffect(() => {
    let cancelled = false
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
        const height = Math.max(110, rect.height || wrapper?.clientHeight || 124)
        canvasEl.width = Math.round(width * dpr)
        canvasEl.height = Math.round(height * dpr)
        const ctx = canvasEl.getContext('2d')
        if (!ctx) return
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        drawRetentionChart(ctx, width, height, points)
        return
      }

      const query = Taro.createSelectorQuery()
      query
        .select(`#${canvasId}`)
        .fields({ node: true, size: true })
        .exec((res) => {
          if (cancelled || !res?.[0]?.node) return
          const canvas = res[0].node
          const width = Math.max(240, res[0].width || 300)
          const height = Math.max(100, res[0].height || 124)
          canvas.width = Math.round(width * dpr)
          canvas.height = Math.round(height * dpr)
          const ctx = canvas.getContext('2d')
          if (!ctx) return
          ctx.scale(dpr, dpr)
          drawRetentionChart(ctx, width, height, points)
        })
    }, 60)

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
