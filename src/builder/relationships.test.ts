// 关系引用完整性：生成的 docx 中每个 r:id / r:embed 等关系引用，都必须能在所在部件的 .rels 里找到。
//
// 悬空的关系引用会让 Word 打开时提示「发现无法读取的内容」并要求修复，而单看 XML 结构的断言发现不了它
// （曾因 docx 给文档内链接里的图片写出悬空的 a:hlinkClick 而漏网）。这里用一份混合了所有会产生关系的
// 元素的文档做整体检查，以后任何结构写出悬空引用都会在此暴露。

import { describe, it, expect } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { htmlToDocx } from '../index.js'

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAeImBZsAAAAASUVORK5CYII='

/** 部件路径 → 其关系文件路径，如 word/document.xml → word/_rels/document.xml.rels */
function relsPathOf(part: string): string {
  const slash = part.lastIndexOf('/')
  return `${part.slice(0, slash)}/_rels/${part.slice(slash + 1)}.rels`
}

/** 找出所有悬空的关系引用，返回「部件: 属性=id」列表 */
function danglingRelationships(files: Record<string, Uint8Array>): string[] {
  const out: string[] = []
  for (const [part, bytes] of Object.entries(files)) {
    if (!part.startsWith('word/') || !part.endsWith('.xml')) continue
    const xml = strFromU8(bytes)
    const refs = [...xml.matchAll(/\br:(id|embed|link|pict)="([^"]*)"/g)]
    if (refs.length === 0) continue
    const relsBytes = files[relsPathOf(part)]
    const rels = relsBytes !== undefined ? strFromU8(relsBytes) : ''
    const ids = new Set([...rels.matchAll(/\bId="([^"]+)"/g)].map((m) => m[1]))
    for (const [, attr, id] of refs) {
      if (!ids.has(id)) out.push(`${part}: r:${attr}=${id}`)
    }
  }
  return out
}

const RICH_HTML = `
<h2 id="top">顶部</h2>
<p>外部文字链接 <a href="https://example.com">example</a>，文档内文字链接 <a href="#top">回顶部</a>。</p>
<p>外部图片链接 <a href="https://example.com/img"><img src="${PNG}"></a></p>
<p>文档内图片链接 <a href="#top"><img src="${PNG}"></a></p>
<p>普通图片 <img src="${PNG}" alt="图"></p>
<table><tr><td><a href="https://example.com/cell"><img src="${PNG}"></a></td><td><a href="#top">格内锚点</a></td></tr></table>
<p>脚注引用<sup class="wp-footnote-ref"><a href="#fn-1">[1]</a></sup></p>
<div class="footnotes"><ol><li id="fn-1">脚注里的 <a href="https://example.com/fn">链接</a> 与图片 <img src="${PNG}"></li></ol></div>
`

describe('关系引用完整性', () => {
  it('混合文档中没有悬空的关系引用（图片、内外链接、表格、脚注、页眉页脚）', async () => {
    const files = unzipSync(
      await htmlToDocx(RICH_HTML, {
        header: { left: '页眉', right: '右' },
        footer: { center: '页脚' },
        pageNumber: { enabled: true, position: 'footer-right' },
      }),
    )
    // 确认样例确实覆盖到了会产生关系的部件
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining(['word/document.xml', 'word/footnotes.xml']),
    )
    expect(danglingRelationships(files)).toEqual([])
  })

  it('检查本身有效：人为制造的悬空引用能被发现', () => {
    const files = {
      'word/document.xml': new TextEncoder().encode(
        '<w:document><a:blip r:embed="rIdX"/></w:document>',
      ),
      'word/_rels/document.xml.rels': new TextEncoder().encode('<Relationships/>'),
    }
    expect(danglingRelationships(files)).toEqual(['word/document.xml: r:embed=rIdX'])
  })
})
