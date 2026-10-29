import { Packer } from 'docx'
import { unzipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'
import { htmlToDocument } from '../index.js'
import { pack } from './pack.js'

// 最小合法 JPEG 头（SOF0，800×600）+ 伪随机负载，足够让库识别格式与尺寸
function fakeJpeg(size: number): Uint8Array {
  const head = [
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x03, 0x20, 0x03, 0x01, 0x22, 0x00, 0x02,
    0x11, 0x01, 0x03, 0x11, 0x01,
  ]
  const bytes = new Uint8Array(size)
  bytes.set(head)
  let seed = 1
  for (let i = head.length; i < size - 2; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0
    bytes[i] = seed >>> 24
  }
  bytes[size - 2] = 0xff
  bytes[size - 1] = 0xd9
  return bytes
}

/** 逐个读 zip 本地文件头，得到每个条目的压缩方式（0 = STORE，8 = DEFLATE） */
function zipMethods(zip: Uint8Array): Map<string, number> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  const methods = new Map<string, number>()
  let offset = 0
  while (offset + 30 <= zip.length && view.getUint32(offset, true) === 0x04034b50) {
    const method = view.getUint16(offset + 8, true)
    const compressedSize = view.getUint32(offset + 18, true)
    const nameLength = view.getUint16(offset + 26, true)
    const extraLength = view.getUint16(offset + 28, true)
    const name = new TextDecoder().decode(zip.subarray(offset + 30, offset + 30 + nameLength))
    methods.set(name, method)
    offset += 30 + nameLength + extraLength + compressedSize
  }
  return methods
}

const jpeg = fakeJpeg(4096)

async function makeDoc() {
  return await htmlToDocument('<p>正文</p><p><img src="asset:a"></p>', {
    imageResolver: async () => ({ data: jpeg, mime: 'image/jpeg' }),
  })
}

describe('pack', () => {
  it('jpg 图片以 STORE 存入，XML 部件仍用 DEFLATE', async () => {
    const methods = zipMethods(await pack(await makeDoc()))
    const media = [...methods].filter(([name]) => name.startsWith('word/media/'))
    expect(media.map(([, method]) => method)).toEqual([0])
    expect(methods.get('word/document.xml')).toBe(8)
  })

  it('包内文件、顺序与全部内容与 docx 自己打包逐字节一致', async () => {
    // 同一个 Document 走两条路：只有压缩级别不同，解压后每个文件都应完全相同。
    // docx 升级改动内部编译逻辑时，这里会第一时间失败
    const doc = await makeDoc()
    const ours = unzipSync(await pack(doc))
    const theirs = unzipSync(new Uint8Array(await Packer.toArrayBuffer(doc)))
    expect(Object.keys(ours)).toEqual(Object.keys(theirs))
    for (const name of Object.keys(theirs)) expect(ours[name], name).toEqual(theirs[name])
    const mediaPath = Object.keys(ours).find((name) => name.startsWith('word/media/'))!
    expect(ours[mediaPath]).toEqual(jpeg)
  })

  // docx 内部结构与预期不符的各种情形：都应退回公开的 Packer.toArrayBuffer，而不是产出损坏的包
  it.each([
    ['编译器不存在', undefined],
    ['compile 不是函数', {}],
    [
      'compile 抛错',
      {
        compile: () => {
          throw new Error('boom')
        },
      },
    ],
    ['返回值不是 Map', { compile: () => ({ 'word/document.xml': '<w:document/>' }) }],
    ['文件内容类型不认识', { compile: () => new Map([['word/document.xml', { xml: '' }]]) }],
    ['文件路径不是字符串', { compile: () => new Map([[1, '<w:document/>']]) }],
  ])('%s：退回 Packer.toArrayBuffer', async (_, compiler) => {
    const doc = await makeDoc()
    const holder = Packer as unknown as { compiler: unknown }
    const original = holder.compiler
    // toArrayBuffer 自己也依赖这个编译器，替换后须一并换成桩，只验证分支选择
    const fallback = new Uint8Array([1, 2, 3])
    const spy = vi.spyOn(Packer, 'toArrayBuffer').mockResolvedValue(fallback.buffer)
    holder.compiler = compiler
    try {
      expect(await pack(doc)).toEqual(fallback)
      expect(spy).toHaveBeenCalledWith(doc)
    } finally {
      holder.compiler = original
      spy.mockRestore()
    }
  })
})
