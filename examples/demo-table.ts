// 表格复杂场景 demo：覆盖 cell 内嵌入样式 / 行内 & 块级公式 / 代码块 / 列表 / 嵌套表
// 跑：npx tsx examples/demo-table.ts
// 输出：examples/out-table.docx，用 Word / WPS 打开目测渲染效果

import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { htmlToDocx } from '../src/index.js'

const html = `
<h1>复杂表格渲染验证</h1>
<p>下表用于人工验证 cell 内各种内容的视觉一致性。请逐列检查。</p>

<table>
  <thead>
    <tr>
      <th>场景</th>
      <th>预期效果</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>inline 样式叠加</strong></td>
      <td>
        <strong>粗体</strong>、<em>斜体</em>、<s>删除线</s>、<u>下划线</u>，
        <span style="color: red">红字</span>、
        <span style="background-color: yellow">黄底高亮</span>、
        <strong style="color: blue; font-size: 14pt">蓝色 14pt 粗体</strong>。
      </td>
    </tr>
    <tr>
      <td><strong>行内公式</strong></td>
      <td>
        勾股定理为 <math><msup><mi>a</mi><mn>2</mn></msup><mo>+</mo><msup><mi>b</mi><mn>2</mn></msup><mo>=</mo><msup><mi>c</mi><mn>2</mn></msup></math>，
        与文字应在同一行。
      </td>
    </tr>
    <tr>
      <td><strong>块级公式</strong></td>
      <td>
        <p>求根公式：</p>
        <math display="block">
          <mi>x</mi><mo>=</mo>
          <mfrac>
            <mrow><mo>-</mo><mi>b</mi><mo>±</mo><msqrt><msup><mi>b</mi><mn>2</mn></msup><mo>-</mo><mn>4</mn><mi>a</mi><mi>c</mi></msqrt></mrow>
            <mrow><mn>2</mn><mi>a</mi></mrow>
          </mfrac>
        </math>
        <p>公式应独立成行，居中，使用数学字体。</p>
      </td>
    </tr>
    <tr>
      <td><strong>代码块</strong></td>
      <td>
        <p>下面是 JS 代码（含特殊字符）：</p>
        <pre><code>function clamp(x, lo, hi) {
  if (x &lt; lo) return lo;
  if (x &gt; hi) return hi;
  return x;
}</code></pre>
        <p>应使用 Consolas 等宽字体，缩进保留。</p>
      </td>
    </tr>
    <tr>
      <td><strong>无序列表</strong></td>
      <td>
        <ul>
          <li>第一项普通文本</li>
          <li><strong>第二项</strong>含粗体</li>
          <li>第三项含 <span style="background-color: yellow">高亮</span></li>
        </ul>
      </td>
    </tr>
    <tr>
      <td><strong>有序列表</strong></td>
      <td>
        <ol>
          <li>步骤一</li>
          <li>步骤二
            <ol>
              <li>嵌套 a</li>
              <li>嵌套 b</li>
            </ol>
          </li>
          <li>步骤三</li>
        </ol>
      </td>
    </tr>
    <tr>
      <td><strong>综合（混合）</strong></td>
      <td>
        <p><strong>说明</strong>：圆周率 <math><mi>π</mi></math> 满足下式</p>
        <math display="block"><mi>π</mi><mo>=</mo><mfrac><mi>C</mi><mi>d</mi></mfrac></math>
        <pre><code>const PI = 3.14159;</code></pre>
        <ul>
          <li><em>近似值</em></li>
          <li><span style="background-color: yellow">高亮项</span></li>
        </ul>
      </td>
    </tr>
    <tr>
      <td><strong>嵌套表格</strong></td>
      <td>
        外层 cell 包内层小表：
        <table>
          <tr><th>键</th><th>值</th></tr>
          <tr><td>x</td><td>1</td></tr>
          <tr><td>y</td><td>2</td></tr>
        </table>
        嵌套表 borders / 列宽 应正常显示。
      </td>
    </tr>
  </tbody>
</table>

<p>验证结束。</p>
`

const out = await htmlToDocx(html, {
  title: '复杂表格渲染验证',
  page: { size: 'A4', orientation: 'portrait' },
})

const here = dirname(fileURLToPath(import.meta.url))
const target = resolve(here, 'out-table.docx')
await writeFile(target, out)
console.log(`已生成: ${target} (${out.byteLength} bytes)`)
