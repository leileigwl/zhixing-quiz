import type { UserConfigExport } from '@tarojs/cli'

const envBaseUrl = (process.env.TARO_APP_API_BASE_URL || '').trim()

export default {
  defineConstants: {
    API_BASE_URL: JSON.stringify(envBaseUrl),
  },
  mini: {},
  h5: {},
} satisfies UserConfigExport<'webpack5'>
