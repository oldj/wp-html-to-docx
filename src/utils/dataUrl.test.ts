import { describe, it, expect } from 'vitest'
import { isDataUrl, parseDataUrl } from './dataUrl.js'

describe('isDataUrl', () => {
  it('识别 data: 前缀', () => {
    expect(isDataUrl('data:image/png;base64,xxx')).toBe(true)
    expect(isDataUrl('https://x.com/a.png')).toBe(false)
    expect(isDataUrl('')).toBe(false)
  })
})

describe('parseDataUrl', () => {
  it('base64 编码解码', () => {
    // 'hi' base64 = 'aGk='
    const { mime, data } = parseDataUrl('data:text/plain;base64,aGk=')
    expect(mime).toBe('text/plain')
    expect(data).toEqual(new Uint8Array([0x68, 0x69]))
  })

  it('非 base64 (percent-encoded)', () => {
    const { mime, data } = parseDataUrl('data:text/plain,Hello%20World')
    expect(mime).toBe('text/plain')
    expect(new TextDecoder().decode(data)).toBe('Hello World')
  })

  it('缺省 mime 时兜底 application/octet-stream', () => {
    const { mime } = parseDataUrl('data:;base64,aGk=')
    expect(mime).toBe('application/octet-stream')
  })

  it('非法格式抛错', () => {
    expect(() => parseDataUrl('not-a-data-url')).toThrow(/Invalid data URL/)
  })

  it('mime 含额外参数（charset 等）仍可解码', () => {
    // 防回归：曾经 data:image/png;charset=utf-8;base64,... 这种带 mediatype 参数的合法形式
    // 会被 ([^;,]+)?(;base64)? 正则拒绝抛 Invalid data URL
    const { mime, data } = parseDataUrl('data:text/plain;charset=utf-8;base64,aGk=')
    expect(mime).toBe('text/plain')
    expect(data).toEqual(new Uint8Array([0x68, 0x69]))
  })

  it('base64 payload 含换行：去除空白后正常解码', () => {
    // 多行 base64 载荷在严格 atob 实现下会抛 InvalidCharacterError
    const { data } = parseDataUrl('data:text/plain;base64,aGk\n=')
    expect(data).toEqual(new Uint8Array([0x68, 0x69]))
  })

  it('非 base64 含未编码 % 字面量：降级为原文，不抛 URIError', () => {
    // 防回归：inline SVG 的 data URL 常含未编码 %（如 width="100%"），decodeURIComponent 抛错
    const { mime, data } = parseDataUrl('data:image/svg+xml,<svg width="100%"/>')
    expect(mime).toBe('image/svg+xml')
    expect(new TextDecoder().decode(data)).toBe('<svg width="100%"/>')
  })
})
