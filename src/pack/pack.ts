// 把 docx.Document 打包为 Uint8Array
// 选用 Packer.toArrayBuffer：返回 ArrayBuffer，双端通用，无 Buffer 依赖

import { Document, Packer } from 'docx'

/**
 * 将 Document 打包为 Uint8Array。
 * 调用方在 Node 可用 `Buffer.from(u8)`，浏览器可 `new Blob([u8])`。
 */
export async function pack(doc: Document): Promise<Uint8Array> {
  const ab = await Packer.toArrayBuffer(doc)
  return new Uint8Array(ab)
}
