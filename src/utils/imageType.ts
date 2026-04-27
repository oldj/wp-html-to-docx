// 推断图片类型：优先从 mime，回退到 magic bytes
// docx ImageRun 接受 'jpg' | 'png' | 'gif' | 'bmp'；svg 需要 docx 库的 fallback 机制，本库暂不支持

export type DocxImageType = 'jpg' | 'png' | 'gif' | 'bmp'

export function inferImageType(
  mime: string | undefined,
  data: Uint8Array,
): DocxImageType {
  const m = mime?.toLowerCase()
  if (m === 'image/png') return 'png'
  if (m === 'image/jpeg' || m === 'image/jpg') return 'jpg'
  if (m === 'image/gif') return 'gif'
  if (m === 'image/bmp' || m === 'image/x-bmp') return 'bmp'
  return inferFromMagicBytes(data)
}

function inferFromMagicBytes(data: Uint8Array): DocxImageType {
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    data.length >= 4 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47
  ) {
    return 'png'
  }
  // JPEG: FF D8 FF
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'jpg'
  }
  // GIF: 47 49 46
  if (data.length >= 3 && data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) {
    return 'gif'
  }
  // BMP: 42 4D
  if (data.length >= 2 && data[0] === 0x42 && data[1] === 0x4d) {
    return 'bmp'
  }
  // 兜底：当作 png
  return 'png'
}
