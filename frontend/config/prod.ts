import type { UserConfigExport } from '@tarojs/cli'

import { resolveProdApiBaseUrl } from './apiBaseUrl'

const isDev = process.env.NODE_ENV === 'development'
// dev 模式下 prod.ts 也会被 import（但不会 merge），此时不校验，避免影响本地调试
const envBaseUrl = isDev ? '' : resolveProdApiBaseUrl(process.env)

export default {
  defineConstants: {
    API_BASE_URL: JSON.stringify(envBaseUrl),
  },
  mini: {},
  h5: {},
} satisfies UserConfigExport<'webpack5'>
