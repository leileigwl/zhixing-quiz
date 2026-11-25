import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Taro from '@tarojs/taro'

async function loadApi() {
  vi.resetModules()
  return import('./api')
}

const jsonResp = (body: unknown, status = 200) =>
  ({ status, json: async () => body }) as unknown as Response

describe('头像上传 API', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    Taro.setStorageSync('zx_token', 'tok-1')
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    fetchMock.mockReset()
  })

  it('H5：multipart 提交到 /user/avatar，带 Bearer，返回 avatar_url', async () => {
    const api = await loadApi()
    fetchMock.mockResolvedValueOnce(jsonResp({ code: 0, message: 'ok', data: { avatar_url: 'https://s/a.jpg' } }))
    const res = await api.uploadAvatarWebFile(new Blob(['x'], { type: 'image/jpeg' }))
    expect(res.avatar_url).toBe('https://s/a.jpg')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.test/api/v1/user/avatar')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer tok-1')
    expect(init.body).toBeInstanceOf(FormData)
    expect((init.body as FormData).get('file')).toBeTruthy()
  })

  it('H5：后端校验失败时抛出后端文案', async () => {
    const api = await loadApi()
    fetchMock.mockResolvedValueOnce(jsonResp({ code: 4002, message: '头像仅支持 JPG / PNG / WebP / GIF 图片', data: null }, 400))
    await expect(api.uploadAvatarWebFile(new Blob(['x']))).rejects.toThrow('头像仅支持')
  })

  it('H5：网络失败 / 413 非 JSON 给出友好文案', async () => {
    const api = await loadApi()
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(api.uploadAvatarWebFile(new Blob(['x']))).rejects.toThrow('网络连接失败')
    fetchMock.mockResolvedValueOnce({ status: 413, json: async () => { throw new Error('html') } } as unknown as Response)
    await expect(api.uploadAvatarWebFile(new Blob(['x']))).rejects.toThrow('图片太大')
  })

  it('小程序：Taro.uploadFile 上传临时路径', async () => {
    const api = await loadApi()
    vi.mocked(Taro.uploadFile).mockImplementationOnce((opts: any) => {
      opts.success({ statusCode: 200, data: JSON.stringify({ code: 0, data: { avatar_url: 'https://s/b.png' } }) })
      return undefined as any
    })
    const res = await api.uploadAvatarFromPath('wxfile://tmp/a.png')
    expect(res.avatar_url).toBe('https://s/b.png')
    const opts = vi.mocked(Taro.uploadFile).mock.calls[0][0] as any
    expect(opts.url).toBe('https://api.test/api/v1/user/avatar')
    expect(opts.name).toBe('file')
    expect(opts.header.Authorization).toBe('Bearer tok-1')
  })

  it('小程序：业务失败与网络失败都 reject', async () => {
    const api = await loadApi()
    vi.mocked(Taro.uploadFile).mockImplementationOnce((opts: any) => {
      opts.success({ statusCode: 400, data: JSON.stringify({ code: 4002, message: '头像图片不能超过 2MB' }) })
      return undefined as any
    })
    await expect(api.uploadAvatarFromPath('p')).rejects.toThrow('2MB')
    vi.mocked(Taro.uploadFile).mockImplementationOnce((opts: any) => {
      opts.success({ statusCode: 502, data: '<html>' })
      return undefined as any
    })
    await expect(api.uploadAvatarFromPath('p')).rejects.toThrow('解析失败')
    vi.mocked(Taro.uploadFile).mockImplementationOnce((opts: any) => {
      opts.fail({ errMsg: 'uploadFile:fail timeout' })
      return undefined as any
    })
    await expect(api.uploadAvatarFromPath('p')).rejects.toThrow('timeout')
  })
})
