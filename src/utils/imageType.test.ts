import { describe, it, expect } from 'vitest'
import { detectUnsupportedImageFormat, inferImageType } from './imageType.js'

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

describe('detectUnsupportedImageFormat', () => {
  const empty = new Uint8Array()

  it('从 mime 识别：webp / svg / avif / heic / tiff / ico', () => {
    expect(detectUnsupportedImageFormat('image/webp', empty)).toBe('webp')
    expect(detectUnsupportedImageFormat('image/svg+xml', empty)).toBe('svg')
    expect(detectUnsupportedImageFormat('image/avif', empty)).toBe('avif')
    expect(detectUnsupportedImageFormat('image/heic', empty)).toBe('heic')
    expect(detectUnsupportedImageFormat('image/tiff', empty)).toBe('tiff')
    expect(detectUnsupportedImageFormat('image/x-icon', empty)).toBe('ico')
  })

  it('mime 带参数（image/webp;charset=...）也能识别', () => {
    expect(detectUnsupportedImageFormat('image/webp;foo=bar', empty)).toBe('webp')
  })

  it('从 magic bytes 识别 WebP（RIFF....WEBP）', () => {
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])
    expect(detectUnsupportedImageFormat(undefined, webp)).toBe('webp')
  })

  it('RIFF 但非 WEBP（如 WAV）不误判', () => {
    const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45])
    expect(detectUnsupportedImageFormat(undefined, wav)).toBeNull()
  })

  it('从 ftyp box 识别 AVIF 与 HEIC', () => {
    const avif = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66])
    expect(detectUnsupportedImageFormat(undefined, avif)).toBe('avif')
    const heic = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63])
    expect(detectUnsupportedImageFormat(undefined, heic)).toBe('heic')
  })

  it('从 magic bytes 识别 TIFF 两种字节序', () => {
    expect(detectUnsupportedImageFormat(undefined, new Uint8Array([0x49, 0x49, 0x2a, 0x00]))).toBe(
      'tiff',
    )
    expect(detectUnsupportedImageFormat(undefined, new Uint8Array([0x4d, 0x4d, 0x00, 0x2a]))).toBe(
      'tiff',
    )
  })

  it('从文本头识别 SVG（含 <?xml 序言与前导空白）', () => {
    const enc = (s: string) => new TextEncoder().encode(s)
    expect(detectUnsupportedImageFormat(undefined, enc('<svg xmlns="x"></svg>'))).toBe('svg')
    expect(detectUnsupportedImageFormat(undefined, enc('  <?xml version="1.0"?><svg></svg>'))).toBe(
      'svg',
    )
  })

  it('支持的格式（png/jpg）返回 null', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(detectUnsupportedImageFormat('image/png', png)).toBeNull()
    expect(detectUnsupportedImageFormat(undefined, png)).toBeNull()
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
    expect(detectUnsupportedImageFormat(undefined, jpg)).toBeNull()
  })

  it('普通 XML / HTML 文本（非 SVG）不误判', () => {
    const enc = (s: string) => new TextEncoder().encode(s)
    expect(detectUnsupportedImageFormat(undefined, enc('<?xml version="1.0"?><root/>'))).toBeNull()
  })
})
