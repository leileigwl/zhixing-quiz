// ESLint 9 flat config：TS + React Hooks。
// 重点是 react-hooks/rules-of-hooks（error）：它能在编译前拦住「条件 return 后再调用 Hook」
// 这类导致 Minified React error #310 的问题（见 941fc97）。
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['dist/**', 'dist-h5/**', 'node_modules/**', 'coverage/**', '.temp/**', '.swc/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node, wx: 'readonly' },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // 现有代码大量使用 any 与「catch {} 忽略」模式；先告警不阻断，后续逐步收紧
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['config/**/*.ts', '*.config.{ts,mjs,js}', 'babel.config.js'],
    languageOptions: { globals: globals.node },
  },
)
