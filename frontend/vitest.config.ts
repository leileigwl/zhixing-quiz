import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// 固定为用户所在时区，日期分桶类用例（北京时间 0~8 点）才有意义且在 CI（UTC）上结果一致
process.env.TZ = 'Asia/Shanghai'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  // 与 config/dev.ts、config/prod.ts 的 defineConstants 对齐
  define: {
    API_BASE_URL: JSON.stringify('https://api.test/api/v1'),
    'process.env.TARO_ENV': JSON.stringify('h5'),
  },
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: [
      { find: /^@tarojs\/taro$/, replacement: r('./test/mocks/taro.ts') },
      { find: /^@tarojs\/components$/, replacement: r('./test/mocks/components.tsx') },
      { find: /^@\//, replacement: r('./src/') },
      // 组件内 import './index.scss'：测试不关心样式
      { find: /^.+\.s?css$/, replacement: r('./test/mocks/style.ts') },
    ],
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'config/**/*.test.ts', 'test/**/*.test.{ts,tsx}'],
    restoreMocks: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov'],
      // 只对已有测试守护的逻辑层设阈值，避免页面文件拉低整体导致阈值形同虚设
      include: [
        'src/services/**/*.ts',
        'src/utils/**/*.ts',
        'src/hooks/**/*.ts',
        'src/components/SideNav/**/*.{ts,tsx}',
        'src/components/ResponsiveNav/**/*.tsx',
        'src/components/IcpFooter/**/*.tsx',
        'src/pages/login/index.tsx',
        'src/pages/quiz/quizKeys.ts',
        'src/components/RetentionCurveCanvas/chartModel.ts',
        'src/components/SevenDayRhythmBar/rhythmModel.ts',
        'config/apiBaseUrl.ts',
      ],
      exclude: ['**/*.test.*'],
      thresholds: {
        lines: 70,
        statements: 70,
        functions: 70,
        branches: 70,
      },
    },
  },
})
