// ommlToImported / blockOmmlToImported 单测：
// 守住「失败不会泄露 <undefined> 包裹到产物 XML」与「正常路径返回非 wrap 的子组件」两条线

import { describe, it, expect } from 'vitest'
import { Document, Paragraph, Packer } from 'docx'
import { unzipSync, strFromU8 } from 'fflate'
import { ommlToImported, blockOmmlToImported } from './ommlImport.js'

const OMML_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math'

async function packParagraphWith(child: unknown): Promise<string> {
  // 把单个组件塞进段落 → 单段文档 → 取 word/document.xml
  const para = new Paragraph({ children: [child as never] })
  const doc = new Document({ sections: [{ children: [para] }] })
  const buf = await Packer.toArrayBuffer(doc)
  const files = unzipSync(new Uint8Array(buf))
  const xml = files['word/document.xml']
  if (xml === undefined) throw new Error('document.xml missing')
  return strFromU8(xml)
}

describe('ommlToImported - 正常路径', () => {
  it('合法 OMML 字符串：返回的组件序列化后含 m:oMath，不含 <undefined>', async () => {
    const omml = `<m:oMath xmlns:m="${OMML_NS}"><m:r><m:t>x</m:t></m:r></m:oMath>`
    const ic = ommlToImported(omml)
    expect(ic).not.toBeNull()
    const xml = await packParagraphWith(ic)
    expect(xml).toContain('<m:oMath')
    expect(xml).not.toContain('<undefined')
  })
})

describe('ommlToImported - 异常输入回退', () => {
  it('解析抛错的字符串：返回 null（让上层走 [math] 占位）', () => {
    // 非 XML 输入：fromXmlString 抛错 → catch 捕获 → 返回 null
    expect(ommlToImported('not xml at all <<<')).toBeNull()
  })

  it('空字符串：返回 null', () => {
    expect(ommlToImported('')).toBeNull()
  })
})

describe('blockOmmlToImported - 块级包装', () => {
  it('合法 OMML：包进 m:oMathPara 后产物含两层标签', async () => {
    const omml = `<m:oMath xmlns:m="${OMML_NS}"><m:r><m:t>x</m:t></m:r></m:oMath>`
    const ic = blockOmmlToImported(omml)
    expect(ic).not.toBeNull()
    const xml = await packParagraphWith(ic)
    expect(xml).toContain('<m:oMathPara')
    expect(xml).toContain('<m:oMath')
    expect(xml).not.toContain('<undefined')
  })
})
