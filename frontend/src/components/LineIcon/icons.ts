/**
 * 线性图标（24×24 viewBox、1.8 描边、圆角端点，与底部 Dock / 头像相机徽标的细线风格一致）。
 * 以 SVG data URI 交给 <Image> 渲染：H5 与小程序都能显示，无需引入图标库。
 */

export const ICON_PATHS = {
  /** 今日待巩固：回环 */
  refresh: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  /** 重点攻坚：靶心 */
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
  /** 发起新测验：笔 */
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  /** 本周完成题数：日历 */
  calendar: '<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M16 2.5v4M8 2.5v4M3 10h18"/>',
  /** 记忆曲线：折线图 */
  chart: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
  /** 知识口袋：文件夹 */
  folder: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.5h7.5A2.5 2.5 0 0 1 21 10v7.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5Z"/>',
  /** 上传 */
  upload: '<path d="M12 15.5V4"/><path d="m7 9 5-5 5 5"/><path d="M4 15.5v2A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5v-2"/>',
  /** 文档 */
  file: '<path d="M14 3H6.5A2.5 2.5 0 0 0 4 5.5v13A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V9Z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h5"/>',
  /** 学习印章：奖章 */
  award: '<circle cx="12" cy="9" r="6"/><path d="m8.5 14-1.5 7 5-3 5 3-1.5-7"/>',
  /** 错题：提醒圈 */
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5"/><path d="M12 16.2h.01"/>',
  /** 历史：时钟 */
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  /** 难度：层叠 */
  layers: '<path d="m12 3 9 5-9 5-9-5Z"/><path d="m3 13 9 5 9-5"/>',
  /** 下次遗忘节点：铃铛 */
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  /** 账号 */
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  /** 空状态：火花 */
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/>',
} as const

export type IconName = keyof typeof ICON_PATHS

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** 纯 JS base64（小程序没有 btoa）；只用于 ASCII 的 SVG 文本 */
export function asciiToBase64(input: string): string {
  let out = ''
  let i = 0
  while (i < input.length) {
    const a = input.charCodeAt(i++) & 0xff
    const b = i < input.length ? input.charCodeAt(i++) & 0xff : NaN
    const c = i < input.length ? input.charCodeAt(i++) & 0xff : NaN
    const n = (a << 16) | ((isNaN(b) ? 0 : b) << 8) | (isNaN(c) ? 0 : c)
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63]
    out += isNaN(b) ? '=' : B64[(n >> 6) & 63]
    out += isNaN(c) ? '=' : B64[n & 63]
  }
  return out
}

export function buildIconSvg(name: IconName, color = '#18191e', strokeWidth = 1.8): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" ` +
    `stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">` +
    `${ICON_PATHS[name]}</svg>`
  )
}

const cache = new Map<string, string>()

export function buildIconDataUri(name: IconName, color = '#18191e', strokeWidth = 1.8): string {
  const key = `${name}|${color}|${strokeWidth}`
  const hit = cache.get(key)
  if (hit) return hit
  const uri = `data:image/svg+xml;base64,${asciiToBase64(buildIconSvg(name, color, strokeWidth))}`
  cache.set(key, uri)
  return uri
}
