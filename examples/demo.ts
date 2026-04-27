// 开发期 demo：覆盖常见 HTML 元素，输出到 examples/out.docx 便于手测
// 用 `npm run dev` 启动 watch 模式，每次保存重新生成

import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { htmlToDocx } from '../src/index.js'

const html = `
<h1>wp-html-to-docx 演示</h1>
<p>这是一个段落，包含 <strong>加粗</strong>、<em>斜体</em>、<u>下划线</u>、
<s>删除线</s>、<code>行内代码</code> 和 <a href="https://example.com">外链</a>。</p>

<h2>无序列表</h2>
<ul>
  <li>第一项</li>
  <li>第二项
    <ul>
      <li>嵌套子项</li>
    </ul>
  </li>
  <li>第三项</li>
</ul>

<h2>有序列表</h2>
<ol>
  <li>步骤一</li>
  <li>步骤二</li>
</ol>

<h2>表格</h2>
<table>
  <thead>
    <tr><th>名称</th><th>数量</th></tr>
  </thead>
  <tbody>
    <tr><td>苹果</td><td>3</td></tr>
    <tr><td>香蕉</td><td>5</td></tr>
  </tbody>
</table>

<h2>引用</h2>
<blockquote>
  <p>引用块内的文本，可包含 <strong>样式</strong>。</p>
</blockquote>

<h2>预格式化</h2>
<pre><code>function hello() {
  console.log('hi')
}</code></pre>

<hr>

<p>下方测试 hr 与段落结尾。</p>
`

const out = await htmlToDocx(html, {
  page: {
    size: 'A4',
    margin: { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4, unit: 'mm' },
  },
  header: { left: 'wp-html-to-docx', center: '演示文档' },
  pageNumber: {
    enabled: true,
    position: 'footer-center',
    template: '第 {PAGE} 页 / 共 {TOTAL} 页',
  },
})

const here = dirname(fileURLToPath(import.meta.url))
const target = resolve(here, 'out.docx')
await writeFile(target, out)
console.log(`已生成: ${target} (${out.byteLength} bytes)`)
