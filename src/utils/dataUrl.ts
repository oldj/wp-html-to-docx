// data URL 解码（双端：浏览器 atob / Node 也提供全局 atob，自 Node 16+）

export type DataUrlParsed = {
  mime: string
  data: Uint8Array
}

/**
 * 解析 data:URL，返回 mime 与二进制数据
 * 仅支持 base64 编码形式（图片 data URL 几乎都是 base64）
 * @throws Error 当格式无法识别时
 */
export function parseDataUrl(src: string): DataUrlParsed {
  // data:[<mime>][;base64],<data>
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(src)
  if (!match) {
    throw new Error('Invalid data URL')
  }
  const mime = match[1] ?? 'application/octet-stream'
  const isBase64 = match[2] === ';base64'
  const payload = match[3] ?? ''

  if (!isBase64) {
    // 非 base64：仅按 percent-decoding 处理；图片 data URL 几乎都是 base64，文本场景才会落到这里
    const text = decodeURIComponent(payload)
    return { mime, data: textEncode(text) }
  }

  const binary = atob(payload)
  const data = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    data[i] = binary.charCodeAt(i)
  }
  return { mime, data }
}

function textEncode(text: string): Uint8Array {
  // TextEncoder 在 Node 与浏览器都是全局
  return new TextEncoder().encode(text)
}

export function isDataUrl(src: string): boolean {
  return src.startsWith('data:')
}
