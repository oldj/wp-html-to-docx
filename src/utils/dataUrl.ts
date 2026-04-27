// data URL 解码（双端：浏览器 atob / Node 也提供全局 atob，自 Node 16+）

export type DataUrlParsed = {
  mime: string
  data: Uint8Array
}

/**
 * 解析 data:URL，返回 mime 与二进制数据
 * 支持完整 RFC 2397 语法：`data:[<mediatype>][;base64],<data>`，
 * 其中 mediatype 可包含若干 `;parameter=value`（如 `image/png;charset=utf-8;base64,...`）。
 * @throws Error 当格式无法识别时
 */
export function parseDataUrl(src: string): DataUrlParsed {
  // 第一个逗号前是 metadata（mime + 可选 parameters + 可选 ;base64），之后是 payload
  const match = /^data:([^,]*),([\s\S]*)$/.exec(src)
  if (!match) {
    throw new Error('Invalid data URL')
  }
  const meta = match[1] ?? ''
  const payload = match[2] ?? ''
  // ;base64 必须是 metadata 的最后一个 token
  const isBase64 = /;base64\s*$/i.test(meta)
  // 去掉 ;base64 后保留 mime + 其它参数；mime 取首段（无视 charset 等附加参数）
  const cleanMeta = isBase64 ? meta.replace(/;base64\s*$/i, '') : meta
  const mime = cleanMeta.split(';')[0]?.trim() || 'application/octet-stream'

  if (!isBase64) {
    // 非 base64：尝试 percent-decoding；含未编码 % 字面量（如 inline SVG）时降级为原文，
    // 避免 decodeURIComponent 抛 URIError 让整个图片报错
    let text: string
    try {
      text = decodeURIComponent(payload)
    } catch {
      text = payload
    }
    return { mime, data: textEncode(text) }
  }

  // base64：去掉换行 / 空白，让 atob 在严格实现下也能解码
  const binary = atob(payload.replace(/\s+/g, ''))
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
