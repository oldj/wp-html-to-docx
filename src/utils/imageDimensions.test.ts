import { describe, it, expect } from 'vitest'
import { getIntrinsicSize } from './imageDimensions.js'

// 构造各格式最小文件头：只覆盖尺寸字段，其余填零
function png(width: number, height: number): Uint8Array {
  const d = new Uint8Array(24)
  d.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) // 签名
  d.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8) // 长度 + "IHDR"
  d[16] = (width >>> 24) & 0xff
  d[17] = (width >>> 16) & 0xff
  d[18] = (width >>> 8) & 0xff
  d[19] = width & 0xff
  d[20] = (height >>> 24) & 0xff
  d[21] = (height >>> 16) & 0xff
  d[22] = (height >>> 8) & 0xff
  d[23] = height & 0xff
  return d
}

function gif(width: number, height: number): Uint8Array {
  const d = new Uint8Array(10)
  d.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]) // "GIF89a"
  d[6] = width & 0xff
  d[7] = (width >> 8) & 0xff
  d[8] = height & 0xff
  d[9] = (height >> 8) & 0xff
  return d
}

function bmp(width: number, height: number): Uint8Array {
  const d = new Uint8Array(26)
  d[0] = 0x42
  d[1] = 0x4d // "BM"
  // width int32 LE @18
  d[18] = width & 0xff
  d[19] = (width >> 8) & 0xff
  // height int32 LE @22
  d[22] = height & 0xff
  d[23] = (height >> 8) & 0xff
  return d
}

function jpeg(width: number, height: number): Uint8Array {
  // FF D8 + SOF0 段：FF C0 00 11 08 H(2) W(2)
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
  ])
}

describe('getIntrinsicSize', () => {
  it('PNG：从 IHDR 读出宽高', () => {
    expect(getIntrinsicSize(png(800, 600))).toEqual({ width: 800, height: 600 })
  })

  it('GIF：从逻辑屏幕描述读出宽高（小端）', () => {
    expect(getIntrinsicSize(gif(120, 80))).toEqual({ width: 120, height: 80 })
  })

  it('BMP：从 BITMAPINFOHEADER 读出宽高', () => {
    expect(getIntrinsicSize(bmp(640, 480))).toEqual({ width: 640, height: 480 })
  })

  it('JPEG：扫描到 SOF0 读出宽高（大端，注意 H 在前 W 在后）', () => {
    expect(getIntrinsicSize(jpeg(640, 480))).toEqual({ width: 640, height: 480 })
  })

  it('真实 1x1 透明 PNG（base64 解码）→ 1x1', () => {
    const b64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAeImBZsAAAAASUVORK5CYII='
    const bin = atob(b64)
    const data = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i)
    expect(getIntrinsicSize(data)).toEqual({ width: 1, height: 1 })
  })

  it('无法识别的数据 → null', () => {
    expect(getIntrinsicSize(new Uint8Array([0x00, 0x01, 0x02, 0x03]))).toBeNull()
    expect(getIntrinsicSize(new Uint8Array(0))).toBeNull()
  })
})
