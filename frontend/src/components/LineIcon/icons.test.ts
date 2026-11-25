import { describe, expect, it } from 'vitest'
import { ICON_PATHS, asciiToBase64, buildIconDataUri, buildIconSvg } from './icons'

describe('LineIcon 图标', () => {
  it('纯 JS base64 与浏览器 btoa 一致（含 1/2 字节补位）', () => {
    for (const s of ['a', 'ab', 'abc', 'abcd', '<svg stroke="#18191e"/>']) {
      expect(asciiToBase64(s)).toBe(btoa(s))
    }
  })

  it('每个图标都是合法的线性 SVG data URI', () => {
    for (const name of Object.keys(ICON_PATHS) as Array<keyof typeof ICON_PATHS>) {
      const uri = buildIconDataUri(name, '#2563eb')
      expect(uri.startsWith('data:image/svg+xml;base64,')).toBe(true)
      const svg = atob(uri.split(',')[1])
      expect(svg).toContain('stroke="#2563eb"')
      expect(svg).toContain('fill="none"')
      expect(svg).toBe(buildIconSvg(name, '#2563eb'))
    }
  })

  it('同参数命中缓存返回同一字符串', () => {
    expect(buildIconDataUri('chart')).toBe(buildIconDataUri('chart'))
  })
})
