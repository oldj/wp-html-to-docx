// 无依赖的图片固有尺寸解码：只读文件头，支持 docx 能直接消费的 PNG / JPEG / GIF / BMP 四种格式
//（与 utils/imageType.ts 支持的类型一致）。解码失败返回 null，由调用方退回默认尺寸。
//
// 设计取舍：不引入 image-size 等第三方依赖，保持本包零新增运行时依赖、回装简单。

export type PixelSize = { width: number; height: number }

/** 从图片二进制数据解析固有像素尺寸；无法识别时返回 null。 */
export function getIntrinsicSize(data: Uint8Array): PixelSize | null {
  return readPng(data) ?? readGif(data) ?? readBmp(data) ?? readJpeg(data)
}

// 在 noUncheckedIndexedAccess 下，越界索引为 undefined；本文件所有取值前都做了长度校验，
// 故用 `?? 0` 收敛为 number，避免到处写非空断言。
function at(d: Uint8Array, i: number): number {
  return d[i] ?? 0
}

function valid(width: number, height: number): PixelSize | null {
  return width > 0 && height > 0 ? { width, height } : null
}

function readPng(d: Uint8Array): PixelSize | null {
  // 签名 89 50 4E 47；IHDR 紧随文件头：8 字节签名 + 4 长度 + "IHDR" 后即宽(4)高(4)，大端
  if (
    d.length < 24 ||
    at(d, 0) !== 0x89 ||
    at(d, 1) !== 0x50 ||
    at(d, 2) !== 0x4e ||
    at(d, 3) !== 0x47
  ) {
    return null
  }
  return valid(readU32BE(d, 16), readU32BE(d, 20))
}

function readGif(d: Uint8Array): PixelSize | null {
  // "GIF"；逻辑屏幕宽高在偏移 6..9，小端 uint16
  if (d.length < 10 || at(d, 0) !== 0x47 || at(d, 1) !== 0x49 || at(d, 2) !== 0x46) return null
  return valid(at(d, 6) | (at(d, 7) << 8), at(d, 8) | (at(d, 9) << 8))
}

function readBmp(d: Uint8Array): PixelSize | null {
  // "BM"；BITMAPINFOHEADER 宽在偏移 18、高在 22（int32 小端，高可能为负表示自上而下，取绝对值）
  if (d.length < 26 || at(d, 0) !== 0x42 || at(d, 1) !== 0x4d) return null
  return valid(Math.abs(readI32LE(d, 18)), Math.abs(readI32LE(d, 22)))
}

function readJpeg(d: Uint8Array): PixelSize | null {
  // FF D8 起始；逐段扫描，遇 SOFn（C0..CF，除 C4=DHT / C8=JPG / CC=DAC）读出宽高
  if (d.length < 4 || at(d, 0) !== 0xff || at(d, 1) !== 0xd8) return null
  let offset = 2
  const len = d.length
  while (offset + 1 < len) {
    if (at(d, offset) !== 0xff) {
      offset++ // 重新对齐到下一个 0xFF
      continue
    }
    let marker = at(d, offset + 1)
    // 跳过连续填充字节 0xFF
    while (marker === 0xff && offset + 2 < len) {
      offset++
      marker = at(d, offset + 1)
    }
    offset += 2 // 消费 FF + marker
    // 无长度负载的独立标记：SOI(D8) / EOI(D9) / TEM(01) / RSTn(D0..D7)
    if (
      marker === 0xd8 ||
      marker === 0xd9 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      continue
    }
    if (offset + 1 >= len) break
    const segLen = (at(d, offset) << 8) | at(d, offset + 1) // 含这 2 字节长度自身
    if (segLen < 2) break
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isSof) {
      // 段体：precision(1) height(2 BE) width(2 BE)
      if (offset + 6 >= len) break
      return valid(
        (at(d, offset + 5) << 8) | at(d, offset + 6),
        (at(d, offset + 3) << 8) | at(d, offset + 4),
      )
    }
    offset += segLen // 跳过本段负载，到下一个标记
  }
  return null
}

function readU32BE(d: Uint8Array, i: number): number {
  // 用乘法而非 << 24，避免高位被当成符号位得到负数
  return at(d, i) * 0x1000000 + (at(d, i + 1) << 16) + (at(d, i + 2) << 8) + at(d, i + 3)
}

function readI32LE(d: Uint8Array, i: number): number {
  // (at(d, i+3) << 24) 自带符号扩展，结果为有符号整数
  return at(d, i) | (at(d, i + 1) << 8) | (at(d, i + 2) << 16) | (at(d, i + 3) << 24)
}
