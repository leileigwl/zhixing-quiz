import type { UserConfigExport } from '@tarojs/cli'

const apiBaseUrl = process.env.TARO_APP_API_BASE_URL || 'http://127.0.0.1:8000/api/v1'

export default {
  logger: {
    quiet: false,
    stats: true,
  },
  defineConstants: {
    API_BASE_URL: JSON.stringify(apiBaseUrl),
  },
  mini: {},
  h5: {},
} satisfies UserConfigExport<'webpack5'>
