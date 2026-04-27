import { describe, it, expect } from 'vitest'
import { resolvePageSizeTwip, toTwip } from './units.js'

describe('toTwip', () => {
  it('inch → twip', () => {
    expect(toTwip(1, 'in')).toBe(1440)
    expect(toTwip(0.5, 'in')).toBe(720)
  })

  it('mm → twip (25.4mm = 1in = 1440 twip)', () => {
    expect(toTwip(25.4, 'mm')).toBe(1440)
  })

  it('pt → twip (72pt = 1in)', () => {
    expect(toTwip(72, 'pt')).toBe(1440)
  })
})

describe('resolvePageSizeTwip', () => {
  it('A4：210mm x 297mm', () => {
    const dim = resolvePageSizeTwip('A4')
    expect(dim.width).toBe(toTwip(210, 'mm'))
    expect(dim.height).toBe(toTwip(297, 'mm'))
  })

  it('Letter：8.5in x 11in', () => {
    const dim = resolvePageSizeTwip('Letter')
    expect(dim.width).toBe(toTwip(8.5, 'in'))
    expect(dim.height).toBe(toTwip(11, 'in'))
  })

  it('自定义尺寸默认 pt 单位', () => {
    const dim = resolvePageSizeTwip({ width: 72, height: 144 })
    expect(dim.width).toBe(1440)
    expect(dim.height).toBe(2880)
  })
})
