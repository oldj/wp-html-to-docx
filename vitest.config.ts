import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // 显式 import 风格，无需全局 expect / describe
    globals: false,
    include: ['src/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.{test,spec}.ts'],
    },
  },
})
