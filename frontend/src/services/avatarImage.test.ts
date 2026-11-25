import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AVATAR_MSG, AVATAR_MAX_SOURCE_BYTES, compressAvatarImage, computeSquareCrop, validateAvatarFile } from './avatarImage'

describe('validateAvatarFile', () => {
  it.each([
    { name: 'a.jpg', type: 'image/jpeg', size: 1000 },
    { name: 'a.png', type: 'image/png', size: 1000 },
    { name: 'IMG_0001.HEIC', type: 'image/heic', size: 3_000_000 },
    { name: 'photo.webp', type: '', size: 1000 },
  ])('接受图片 %o', (f) => {
    expect(validateAvatarFile(f)).toBeNull()
  })

  it('拒绝非图片与 SVG', () => {
    expect(validateAvatarFile({ name: 'a.pdf', type: 'application/pdf', size: 10 })).toBe(AVATAR_MSG.notImage)
    expect(validateAvatarFile({ name: 'a.svg', type: 'image/svg+xml', size: 10 })).toBe(AVATAR_MSG.notImage)
    expect(validateAvatarFile({ name: 'noext', type: '', size: 10 })).toBe(AVATAR_MSG.notImage)
  })

  it('拒绝空文件与超大文件', () => {
    expect(validateAvatarFile(null)).toBe(AVATAR_MSG.empty)
    expect(validateAvatarFile({ name: 'a.jpg', type: 'image/jpeg', size: 0 })).toBe(AVATAR_MSG.empty)
    expect(validateAvatarFile({ name: 'a.jpg', type: 'image/jpeg', size: AVATAR_MAX_SOURCE_BYTES + 1 })).toBe(
      AVATAR_MSG.tooLarge,
    )
  })
})

describe('computeSquareCrop', () => {
  it('横图取中间正方形', () => {
    expect(computeSquareCrop(400, 300)).toEqual({ sx: 50, sy: 0, size: 300 })
  })
  it('竖图取中间正方形', () => {
    expect(computeSquareCrop(300, 500)).toEqual({ sx: 0, sy: 100, size: 300 })
  })
  it('正方形原样', () => {
    expect(computeSquareCrop(256, 256)).toEqual({ sx: 0, sy: 0, size: 256 })
  })
})

describe('compressAvatarImage（浏览器 Canvas 替身）', () => {
  const realCreate = document.createElement.bind(document)
  let lastDraw: unknown[] = []

  beforeEach(() => {
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() })
    vi.stubGlobal(
      'Image',
      class {
        naturalWidth = 800
        naturalHeight = 600
        width = 800
        height = 600
        onload: (() => void) | null = null
        onerror: (() => void) | null = null
        set src(v: string) {
          setTimeout(() => (v === 'bad' ? this.onerror?.() : this.onload?.()), 0)
        }
      },
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('裁成正方形并输出 256px JPEG', async () => {
    const out = new Blob(['jpg'], { type: 'image/jpeg' })
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag !== 'canvas') return realCreate(tag)
      return {
        width: 0,
        height: 0,
        getContext: () => ({ fillRect: vi.fn(), drawImage: (...a: unknown[]) => (lastDraw = a), fillStyle: '' }),
        toBlob: (cb: (b: Blob) => void, type: string) => {
          expect(type).toBe('image/jpeg')
          cb(out)
        },
      }
    }) as any)
    const res = await compressAvatarImage(new Blob(['raw']))
    expect(res).toBe(out)
    expect(lastDraw.slice(1)).toEqual([100, 0, 600, 600, 0, 0, 256, 256])
  })

  it('Canvas 不可用时原样返回', async () => {
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
      tag === 'canvas' ? { getContext: () => null } : realCreate(tag)) as any)
    const file = new Blob(['raw'])
    await expect(compressAvatarImage(file)).resolves.toBe(file)
  })

  it('图片解码失败给出提示', async () => {
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'bad'), revokeObjectURL: vi.fn() })
    await expect(compressAvatarImage(new Blob(['raw']))).rejects.toThrow(AVATAR_MSG.decodeFailed)
  })
})
