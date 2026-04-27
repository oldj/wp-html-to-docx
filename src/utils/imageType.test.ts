import { describe, it, expect } from 'vitest'
import { inferImageType } from './imageType.js'

describe('inferImageType - 来自 mime', () => {
  it('image/png', () => {
    expect(inferImageType('image/png', new Uint8Array())).toBe('png')
  })
  it('image/jpeg / image/jpg', () => {
    expect(inferImageType('image/jpeg', new Uint8Array())).toBe('jpg')
    expect(inferImageType('image/jpg', new Uint8Array())).toBe('jpg')
  })
  it('image/gif', () => {
    expect(inferImageType('image/gif', new Uint8Array())).toBe('gif')
  })
  it('image/bmp / image/x-bmp', () => {
    expect(inferImageType('image/bmp', new Uint8Array())).toBe('bmp')
    expect(inferImageType('image/x-bmp', new Uint8Array())).toBe('bmp')
  })
  it('mime 大写不敏感', () => {
    expect(inferImageType('IMAGE/PNG', new Uint8Array())).toBe('png')
  })
})

describe('inferImageType - 来自 magic bytes', () => {
  it('PNG magic 89 50 4E 47', () => {
    const data = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(inferImageType(undefined, data)).toBe('png')
  })
  it('JPEG magic FF D8 FF', () => {
    const data = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
    expect(inferImageType(undefined, data)).toBe('jpg')
  })
  it('GIF magic 47 49 46', () => {
    const data = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
    expect(inferImageType(undefined, data)).toBe('gif')
  })
  it('BMP magic 42 4D', () => {
    const data = new Uint8Array([0x42, 0x4d, 0x00, 0x00])
    expect(inferImageType(undefined, data)).toBe('bmp')
  })
  it('未知 magic 兜底为 png', () => {
    const data = new Uint8Array([0x00, 0x01, 0x02, 0x03])
    expect(inferImageType(undefined, data)).toBe('png')
  })
})
