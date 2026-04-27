import { defineConfig } from 'vitest/config'

// 双环境跑测：node + jsdom
// 库定位为同时支持 Node 与浏览器，因此每个测试两端都跑一遍，
// 覆盖 atob、Uint8Array、Blob 等双端边界差异
export default defineConfig({
  test: {
    globals: false,
    include: ['src/**/*.{test,spec}.ts'],
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.{test,spec}.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: ['src/**/*.{test,spec}.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.{test,spec}.ts', 'src/**/*.d.ts', 'src/index.ts'],
      thresholds: {
        lines: 90,
        branches: 85,
      },
    },
  },
})
