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

<h2 style="text-align: center">居中标题（text-align）</h2>

<p style="text-align: right">本段落右对齐。</p>

<p>下面演示 <span style="color: #d33">红色文本</span>、
<span style="background-color: yellow">黄色高亮</span>、
<span style="font-size: 18pt">大号字</span>、
<span style="font-family: 'Courier New', monospace">等宽字体</span>，
以及 <strong style="color: blue">蓝色粗体</strong> 的组合。</p>

<h2>数学公式（MathML → OMML）</h2>
<p>行内：勾股定理 <math><msup><mi>a</mi><mn>2</mn></msup><mo>+</mo><msup><mi>b</mi><mn>2</mn></msup><mo>=</mo><msup><mi>c</mi><mn>2</mn></msup></math>。</p>
<math display="block"><mfrac><mrow><mo>-</mo><mi>b</mi><mo>±</mo><msqrt><msup><mi>b</mi><mn>2</mn></msup><mo>-</mo><mn>4</mn><mi>a</mi><mi>c</mi></msqrt></mrow><mrow><mn>2</mn><mi>a</mi></mrow></mfrac></math>

<h2>引用</h2>
<blockquote>
  <p>引用块内的文本，可包含 <strong>样式</strong>。</p>
</blockquote>

<h2>分页符</h2>
<p>下一段使用 CSS 强制分页：</p>
<p style="page-break-before: always">这段在新一页开头。</p>
<p>这段没有分页指令。</p>
<hr class="page-break">
<p>上一行是 <code>&lt;hr class="page-break"&gt;</code>，把横线替代成了分页。</p>

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
