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
})
