// 验证当 optional peer 'mathml2omml' 未安装 / 抛错 / 输入异常时的软退回行为：
// mathmlToOmml 返回 null，由调用方走占位回退，且只 warn 一次。

import { describe, it, expect, beforeEach, vi } from 'vitest'

beforeEach(() => {
  vi.resetModules()
  vi.doUnmock('mathml2omml')
})

describe('mathmlToOmml 软退回', () => {
  it('正常路径：返回非空 OMML 字符串', async () => {
    const { mathmlToOmml } = await import('./mml2omml.js')
    const omml = await mathmlToOmml('<math><mn>1</mn></math>')
    expect(typeof omml).toBe('string')
    expect(omml ?? '').toContain('<m:oMath')
  })

  it('parse5 丢失的 xmlns 会在转换前补上（输入可能不含 xmlns）', async () => {
    const { mathmlToOmml } = await import('./mml2omml.js')
    const omml = await mathmlToOmml('<math><mfrac><mn>1</mn><mn>2</mn></mfrac></math>')
    expect(omml).not.toBeNull()
    expect(omml).toContain('<m:f>')
  })

  it('依赖缺失时返回 null，且仅 warn 一次', async () => {
    vi.doMock('mathml2omml', () => {
      throw new Error('module not found')
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { mathmlToOmml } = await import('./mml2omml.js')
    const r1 = await mathmlToOmml('<math><mn>1</mn></math>')
    const r2 = await mathmlToOmml('<math><mn>2</mn></math>')
    expect(r1).toBeNull()
    expect(r2).toBeNull()
    expect(warnSpy).toHaveBeenCalledTimes(1)
    warnSpy.mockRestore()
  })

  it('转换抛错：返回 null 不影响调用方', async () => {
    vi.doMock('mathml2omml', () => ({
      mml2omml: () => {
        throw new Error('boom')
      },
    }))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { mathmlToOmml } = await import('./mml2omml.js')
    const result = await mathmlToOmml('<math><mn>1</mn></math>')
    expect(result).toBeNull()
    // 转换抛错每次都 warn（不像 missing-dep 只 warn 一次）
    expect(warnSpy.mock.calls.length).toBeGreaterThanOrEqual(1)
    warnSpy.mockRestore()
  })
})
