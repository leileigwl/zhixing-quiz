/**
 * H5 头像：选图校验 + 居中裁成正方形 + 压缩成 256px JPEG（纯逻辑部分可单测，绘制部分依赖浏览器 Canvas）。
 * 压缩后通常只有几十 KB，后端上限 2MB（backend/app/services/avatar_service.py）。
 */

export const AVATAR_OUTPUT_SIZE = 256
/** 原图上限：手机原图常见 3–12MB，压缩前放宽到 20MB */
export const AVATAR_MAX_SOURCE_BYTES = 20 * 1024 * 1024

export const AVATAR_MSG = {
  notImage: '请选择图片文件（JPG / PNG / WebP / HEIC）',
  tooLarge: '图片太大了，请选择 20MB 以内的图片',
  empty: '图片内容为空，请换一张',
  decodeFailed: '这张图片无法读取，请换一张（iPhone 可在相册里选「兼容性最佳」格式）',
} as const

export interface PickedFileMeta {
  name?: string
  type?: string
  size: number
}

const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif|heic|heif|bmp)$/i

/** 返回错误文案；合法返回 null。部分安卓浏览器 type 为空，此时退回看扩展名。 */
export function validateAvatarFile(file: PickedFileMeta | null | undefined): string | null {
  if (!file) return AVATAR_MSG.empty
  const type = (file.type || '').toLowerCase()
  const looksImage = type ? type.startsWith('image/') && type !== 'image/svg+xml' : IMAGE_EXT_RE.test(file.name || '')
  if (!looksImage) return AVATAR_MSG.notImage
  if (!file.size) return AVATAR_MSG.empty
  if (file.size > AVATAR_MAX_SOURCE_BYTES) return AVATAR_MSG.tooLarge
  return null
}

/** 居中裁切正方形的源区域 */
export function computeSquareCrop(width: number, height: number): { sx: number; sy: number; size: number } {
  const size = Math.max(0, Math.min(width, height))
  return {
    sx: Math.max(0, Math.round((width - size) / 2)),
    sy: Math.max(0, Math.round((height - size) / 2)),
    size,
  }
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(AVATAR_MSG.decodeFailed))
    }
    img.src = url
  })
}

/** 浏览器内裁切压缩；Canvas 不可用时原样返回（后端仍会按魔数 + 2MB 校验） */
export async function compressAvatarImage(file: Blob, outSize = AVATAR_OUTPUT_SIZE): Promise<Blob> {
  const img = await loadImage(file)
  const w = img.naturalWidth || img.width
  const h = img.naturalHeight || img.height
  if (!w || !h) throw new Error(AVATAR_MSG.decodeFailed)
  const { sx, sy, size } = computeSquareCrop(w, h)
  const target = Math.min(outSize, size)
  const canvas = document.createElement('canvas')
  canvas.width = target
  canvas.height = target
  const ctx = canvas.getContext('2d')
  if (!ctx) return file
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, target, target)
  ctx.drawImage(img, sx, sy, size, size, 0, 0, target, target)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86))
  return blob || file
}
