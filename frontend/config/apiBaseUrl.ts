/**
 * 生产构建 API 基址校验（HANDOFF §4 第 1 项）。
 *
 * - 生产构建（NODE_ENV !== 'development'）必须显式传入 `TARO_APP_API_BASE_URL`，且必须为 `https://` 绝对地址；
 *   否则直接抛错让 `taro build` 立刻失败，避免产出请求全部失败的小程序 / H5 包。
 * - `api.example.com` 等占位域名默认拒绝；仅当 `TARO_APP_ALLOW_PLACEHOLDER_API=1`（CI 冒烟构建专用）时放行。
 */

const PLACEHOLDER_HOSTS = ['api.example.com', 'your-api.example.com', 'example.com']

export class ApiBaseUrlError extends Error {
  constructor(message: string) {
    super(`[zhixing-quiz] ${message}`)
    this.name = 'ApiBaseUrlError'
  }
}

const HINT =
  '请传入 TARO_APP_API_BASE_URL=https://你的域名/api/v1 再执行 pnpm build:h5 / pnpm build:weapp；' +
  '本地调试请改用 pnpm dev:h5 / pnpm build:weapp:local。'

export function resolveProdApiBaseUrl(env: Record<string, string | undefined> = process.env): string {
  const raw = (env.TARO_APP_API_BASE_URL || '').trim()
  if (!raw) {
    throw new ApiBaseUrlError(`生产构建缺少 TARO_APP_API_BASE_URL。${HINT}`)
  }

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new ApiBaseUrlError(`TARO_APP_API_BASE_URL 不是合法的绝对 URL：「${raw}」。${HINT}`)
  }

  if (parsed.protocol !== 'https:') {
    throw new ApiBaseUrlError(
      `TARO_APP_API_BASE_URL 必须使用 https://（当前为 ${parsed.protocol}//），微信小程序与线上 H5 均要求 HTTPS。${HINT}`,
    )
  }

  const allowPlaceholder = env.TARO_APP_ALLOW_PLACEHOLDER_API === '1'
  const host = parsed.hostname.toLowerCase()
  if (!allowPlaceholder && PLACEHOLDER_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
    throw new ApiBaseUrlError(
      `TARO_APP_API_BASE_URL 仍是占位域名「${host}」。${HINT}（CI 冒烟构建可设置 TARO_APP_ALLOW_PLACEHOLDER_API=1）`,
    )
  }

  return raw.replace(/\/+$/, '')
}
