// 推断图片类型：优先从 mime，回退到 magic bytes
// docx ImageRun 接受 'jpg' | 'png' | 'gif' | 'bmp'；svg 需要 docx 库的 fallback 机制，本库暂不支持

export type DocxImageType = 'jpg' | 'png' | 'gif' | 'bmp'

/**
 * 检测「明确不被 docx 支持」的图片格式，返回格式名；未检出时返回 null。
 *
 * 背景：inferImageType 对未知格式兜底为 png —— 若把 webp/svg 等数据按 png 嵌入，
 * Word 打开时该图显示为红叉（文件本身不损坏但图片坏掉），且用户毫无线索。
 * 收集阶段先用本函数挡掉已知不支持的格式，走 onUnresolvedImage 策略（默认 skip）。
 * 真正未知的格式仍交给 inferImageType 兜底（保守，不改变既有行为）。
 */
export function detectUnsupportedImageFormat(
  mime: string | undefined,
  data: Uint8Array,
): string | null {
  const m = mime?.toLowerCase().split(';')[0]?.trim()
  if (m === 'image/webp') return 'webp'
  if (m === 'image/svg+xml') return 'svg'
  if (m === 'image/avif' || m === 'image/heic' || m === 'image/heif') return m.slice(6)
  if (m === 'image/tiff') return 'tiff'
  if (m === 'image/x-icon' || m === 'image/vnd.microsoft.icon') return 'ico'

  // WebP: "RIFF" + 偏移 8 处 "WEBP"
  if (
    data.length >= 12 &&
    data[0] === 0x52 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x46 &&
    data[8] === 0x57 &&
    data[9] === 0x45 &&
    data[10] === 0x42 &&
    data[11] === 0x50
  ) {
    return 'webp'
  }
  // AVIF / HEIC：ISO-BMFF 容器，偏移 4 处 "ftyp"，紧跟 major brand
  if (
    data.length >= 12 &&
    data[4] === 0x66 &&
    data[5] === 0x74 &&
    data[6] === 0x79 &&
    data[7] === 0x70
  ) {
    const brand = String.fromCharCode(data[8] ?? 0, data[9] ?? 0, data[10] ?? 0, data[11] ?? 0)
    if (brand.startsWith('avi')) return 'avif'
    if (brand.startsWith('hei') || brand === 'mif1') return 'heic'
  }
  // TIFF: II*\0（小端）或 MM\0*（大端）
  if (data.length >= 4) {
    if (data[0] === 0x49 && data[1] === 0x49 && data[2] === 0x2a && data[3] === 0x00) return 'tiff'
    if (data[0] === 0x4d && data[1] === 0x4d && data[2] === 0x00 && data[3] === 0x2a) return 'tiff'
  }
  // SVG：文本探测开头（容忍 BOM / 空白 / <?xml 序言 / 注释），只看前 256 字节
  if (looksLikeSvg(data)) return 'svg'
  return null
}

/** 头部字节是否像 SVG 文本：以 "<svg" 开头，或以 "<?xml"/"<!--" 序言开头且片段内出现 "<svg" */
function looksLikeSvg(data: Uint8Array): boolean {
  if (data.length < 4) return false
  let head = ''
  const limit = Math.min(data.length, 256)
  for (let i = 0; i < limit; i++) head += String.fromCharCode(data[i] ?? 0)
  // 去 BOM（U+FEFF 或原始 UTF-8 三字节 EF BB BF；逐字节读取时 BOM 呈现为后者）与前导空白
  const text = head.replace(/^\uFEFF|^\xEF\xBB\xBF/, '').trimStart()
  if (/^<svg[\s>]/i.test(text)) return true
  return /^<\?xml|^<!--/i.test(text) && /<svg[\s>]/i.test(text)
}

export function inferImageType(mime: string | undefined, data: Uint8Array): DocxImageType {
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
