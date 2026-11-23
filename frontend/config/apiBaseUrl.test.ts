import { describe, expect, it } from 'vitest'
import { ApiBaseUrlError, resolveProdApiBaseUrl } from './apiBaseUrl'

describe('resolveProdApiBaseUrl（生产构建 fail-fast）', () => {
  it('缺失 / 空白时报错', () => {
    expect(() => resolveProdApiBaseUrl({})).toThrow(ApiBaseUrlError)
    expect(() => resolveProdApiBaseUrl({ TARO_APP_API_BASE_URL: '   ' })).toThrow('缺少 TARO_APP_API_BASE_URL')
  })

  it('非绝对 URL 报错', () => {
    expect(() => resolveProdApiBaseUrl({ TARO_APP_API_BASE_URL: '/api/v1' })).toThrow('不是合法的绝对 URL')
  })

  it('非 https 报错', () => {
    expect(() => resolveProdApiBaseUrl({ TARO_APP_API_BASE_URL: 'http://api.zhixing.cn/api/v1' })).toThrow('必须使用 https://')
  })

  it('占位域名默认拒绝，CI 显式放行后通过', () => {
    expect(() => resolveProdApiBaseUrl({ TARO_APP_API_BASE_URL: 'https://api.example.com' })).toThrow('占位域名')
    expect(
      resolveProdApiBaseUrl({ TARO_APP_API_BASE_URL: 'https://api.example.com', TARO_APP_ALLOW_PLACEHOLDER_API: '1' }),
    ).toBe('https://api.example.com')
  })

  it('合法 https 地址去掉末尾斜杠后返回', () => {
    expect(resolveProdApiBaseUrl({ TARO_APP_API_BASE_URL: ' https://api.zhixing.cn/api/v1/ ' })).toBe(
      'https://api.zhixing.cn/api/v1',
    )
  })
})
