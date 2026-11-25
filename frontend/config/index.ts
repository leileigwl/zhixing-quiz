import { defineConfig, type UserConfigExport } from '@tarojs/cli'
import devConfig from './dev'
import prodConfig from './prod'
import { resolveProdApiBaseUrl } from './apiBaseUrl'

export default defineConfig<'webpack5'>(async (merge) => {
  const baseConfig: UserConfigExport<'webpack5'> = {
    projectName: 'zhixing-quiz',
    date: '2026-11-11',
    designWidth: 750,
    deviceRatio: {
      640: 2.34 / 2,
      750: 1,
      375: 2,
      828: 1.81 / 2,
    },
    sourceRoot: 'src',
    outputRoot: process.env.TARO_ENV === 'h5' ? 'dist-h5' : 'dist',
    plugins: ['@tarojs/plugin-framework-react'],
    defineConstants: {},
    copy: {
      // H5 站点图标（favicon / apple-touch-icon / PWA manifest）只拷进 H5 产物根目录，小程序不需要
      patterns:
        process.env.TARO_ENV === 'h5' ? [{ from: 'src/public/', to: 'dist-h5/' }] : [],
      options: {},
    },
    framework: 'react',
    compiler: {
      type: 'webpack5',
      prebundle: {
        enable: false,
      },
    },
    cache: {
      enable: false,
    },
    mini: {
      postcss: {
        pxtransform: {
          enable: true,
          config: {},
        },
        cssModules: {
          enable: false,
          config: {
            namingPattern: 'module',
            generateScopedName: '[name]__[local]___[hash:base64:5]',
          },
        },
      },
    },
    h5: {
      publicPath: '/',
      staticDirectory: 'static',
      devServer: {
        port: 10086,
        host: '0.0.0.0',
      },
      router: {
        mode: 'hash',
      },
      postcss: {
        autoprefixer: {
          enable: true,
          config: {},
        },
        cssModules: {
          enable: false,
          config: {
            namingPattern: 'module',
            generateScopedName: '[name]__[local]___[hash:base64:5]',
          },
        },
      },
    },
  }

  if (process.env.NODE_ENV === 'development') {
    return merge({}, baseConfig, devConfig)
  }

  // 生产构建 fail-fast：缺失 / 非 https / 占位域名时直接中止构建（见 config/apiBaseUrl.ts）
  resolveProdApiBaseUrl(process.env)
  return merge({}, baseConfig, prodConfig)
})
