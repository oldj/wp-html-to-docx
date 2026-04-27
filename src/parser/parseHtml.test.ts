import { describe, it, expect } from 'vitest'
import { parseHtmlBodyChildren, isElement, isTextNode } from './parseHtml.js'

describe('parseHtmlBodyChildren', () => {
  it('解析片段（无 html/body 包裹）', () => {
    const nodes = parseHtmlBodyChildren('<p>x</p>')
    expect(nodes.length).toBeGreaterThan(0)
    const first = nodes[0]
    expect(first).toBeDefined()
    expect(first && isElement(first)).toBe(true)
  })

  it('解析完整文档（含 doctype 与 html）', () => {
    const html = '<!doctype html><html><body><p>x</p></body></html>'
    const nodes = parseHtmlBodyChildren(html)
    expect(nodes.length).toBeGreaterThan(0)
  })

  it('解析含 <html> 但无 doctype', () => {
    const nodes = parseHtmlBodyChildren('<html><body><h1>x</h1></body></html>')
    expect(nodes.length).toBeGreaterThan(0)
  })

  it('类型守卫', () => {
    const nodes = parseHtmlBodyChildren('text')
    const text = nodes[0]
    expect(text).toBeDefined()
    expect(text && isTextNode(text)).toBe(true)
    expect(text && isElement(text)).toBe(false)
  })
})
