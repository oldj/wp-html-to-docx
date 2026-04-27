# wp-html-to-docx

把 HTML 字符串转换为 `.docx` 文件，**同时支持浏览器与 Node.js**。

- 基于 [docx](https://www.npmjs.com/package/docx) 生成 OOXML
- 用 [parse5](https://www.npmjs.com/package/parse5) 解析 HTML（符合 HTML5 规范，自动补全 `tbody` 等隐式节点）
- 双层 API：高层一步到位拿二进制，中间层返回 `docx.Document` 便于自由组合
- 输出统一为 `Uint8Array`，环境无关

## 安装

```bash
npm install wp-html-to-docx
```

需要 Node.js ≥ 24。

## 快速开始

```ts
import { htmlToDocx } from 'wp-html-to-docx'

const html = `
  <h1>报告</h1>
  <p>这是<strong>重要</strong>段落，包含<a href="https://example.com">链接</a>。</p>
  <ul>
    <li>项目一</li>
    <li>项目二
      <ul><li>嵌套项</li></ul>
    </li>
  </ul>
`

const u8 = await htmlToDocx(html)
```

返回值是 `Uint8Array`，由调用方决定如何落地：

### Node.js：写入文件

```ts
import { writeFile } from 'node:fs/promises'
import { htmlToDocx } from 'wp-html-to-docx'

const u8 = await htmlToDocx('<h1>Hello</h1>')
await writeFile('out.docx', u8)
```

### 浏览器：触发下载

```ts
import { htmlToDocx } from 'wp-html-to-docx'

const u8 = await htmlToDocx('<h1>Hello</h1>')
const blob = new Blob([u8], {
  type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
})
const url = URL.createObjectURL(blob)
const a = document.createElement('a')
a.href = url
a.download = 'out.docx'
a.click()
URL.revokeObjectURL(url)
```

## 中间层 API：组合 docx.Document

如果想自定义页头页脚、合并多段 HTML 到同一文档，使用 `htmlToDocument`：

```ts
import { htmlToDocument } from 'wp-html-to-docx'
import { Packer } from 'docx'

const doc = await htmlToDocument('<p>章节内容</p>')
// 在这里可以继续修改 doc，例如追加 section、附加自定义页头等
const buffer = await Packer.toBuffer(doc)
```

## 配置选项

```ts
await htmlToDocx(html, {
  page: {
    size: 'A4',                    // 'A4' | 'A3' | 'A5' | 'Letter' | 'Legal' | 'Tabloid' | { width, height, unit }
    orientation: 'portrait',       // 'portrait' | 'landscape'
    margin: {
      top: 25.4, right: 25.4, bottom: 25.4, left: 25.4,
      header: 12.7, footer: 12.7,
      unit: 'mm',                  // 'mm' | 'in' | 'pt'
    },
  },

  header: '报告标题',                // 字符串 或 { left, center, right }
  footer: { left: '机密', right: '2026' },

  pageNumber: {
    enabled: true,
    start: 1,                      // 起始编号
    format: 'decimal',             // 'decimal' | 'upperRoman' | 'lowerRoman' | 'upperLetter' | 'lowerLetter'
    position: 'footer-center',     // header/footer × left/center/right 共 6 种位置
    template: '第 {PAGE} 页 / 共 {TOTAL} 页',
  },

  // 文档元数据（写入 docProps/core.xml，对应 OOXML core properties；
  // 在 Word 的「文件 → 信息」面板里可见与编辑）
  title: '我的文档',                   // dc:title
  creator: '张三',                     // dc:creator —— 即「作者」字段（Word UI 显示为 Author）
  description: '描述',                 // dc:description
  subject: '主题',                     // dc:subject
  keywords: '财报, 2026, Q4',          // cp:keywords，逗号分隔
  lastModifiedBy: '李四',              // cp:lastModifiedBy，未设置时 docx 库默认写入 "Un-named"

  // 图片解析（见下文）
  imageResolver: undefined,
  onUnresolvedImage: 'skip',       // 'skip' | 'placeholder' | 'error'
})
```

### 图片处理

`<img>` 的 `src` 支持以下来源：

- **`data:` URL**（PNG/JPEG/GIF/BMP）：内置自动解码，无需配置
- **HTTP/HTTPS / 相对路径**：需要提供 `imageResolver`，由调用方决定如何加载

未提供 `imageResolver` 时，外链图片按 `onUnresolvedImage` 处理：

| 策略 | 行为 |
|------|------|
| `skip`（默认） | 静默跳过，不输出任何内容 |
| `placeholder` | 用 `alt` 文本占位 |
| `error` | 抛出错误 |

#### Node.js 示例（用 fetch）

```ts
import { htmlToDocx } from 'wp-html-to-docx'

await htmlToDocx(html, {
  imageResolver: async (src) => {
    const res = await fetch(src)
    const ab = await res.arrayBuffer()
    return {
      data: new Uint8Array(ab),
      mime: res.headers.get('content-type') ?? undefined,
    }
  },
})
```

#### 浏览器示例（同样用 fetch）

```ts
await htmlToDocx(html, {
  imageResolver: async (src) => {
    const res = await fetch(src)
    return { data: new Uint8Array(await res.arrayBuffer()) }
  },
})
```

## 支持的 HTML 标签

**块级**：`p`、`h1-h6`、`ul`、`ol`、`li`（含多级嵌套，自动切换 numbering）、`blockquote`、`hr`、`pre`、`code`

**表格**：`table`、`thead`、`tbody`、`tfoot`、`tr`、`th`、`td`（含 `colspan` / `rowspan`；`thead` 行自动加粗 + 浅灰背景）

**内联**：`strong/b`、`em/i`、`u`、`s/strike/del`、`code`（行内代码）、`a`、`span`、`br`、`img`、`math`（见下文）

**特殊**：`page-break` 自定义标签（见 [分页](#分页)）

**行为细节**：

- HTML 空白默认折叠为单空格；`<pre>` 内保留所有空白与换行
- HTML 实体（`&amp;` `&lt;` `&nbsp;` `&#x4e2d;` 等）自动解码
- `<a>` 与内联格式可任意组合（如 `<a><strong>x</strong></a>`）

## 内联 `style` 属性

支持 `<span style="...">` / `<p style="...">` 等元素上的常用 CSS 属性，自动叠加到对应 docx 样式。**不**实现完整的 CSS 选择器引擎、cascade 与 specificity——只解析直接出现在元素上的内联声明。

| CSS 属性 | docx 映射 | 说明 |
|---|---|---|
| `color` | `TextRun.color` | 命名色 / `#RGB` / `#RRGGBB` / `rgb()` |
| `background` / `background-color` | `TextRun.shading`（CLEAR + fill） | 同上；只取首个颜色 token |
| `font-size` | `TextRun.size` | `pt` / `px` / `em` / `rem` / `%`；`em` 以 12pt 为基准 |
| `font-family` | `TextRun.font` | 取首项去引号 |
| `font-weight: bold` 或数值 ≥ 600 | `bold: true` | 仅加法（不会用 `normal` 取消父级 bold） |
| `font-style: italic` | `italics: true` | 同上 |
| `text-decoration: underline / line-through` | `underline` / `strike` | 支持多个值组合 |
| `text-align`（块级元素） | `Paragraph.alignment` | left / right / center / justify |

```html
<p style="text-align: center">
  <span style="color: #d33; background-color: yellow; font-size: 14pt">
    强调文本
  </span>
</p>
```

> **CJK 字体提示**：docx 的 `<w:rFonts>` 只把 `font-family` 写入 `ascii` / `hAnsi` 槽位；`eastAsia` 槽不变，因此中文字符仍按 Word 默认中文字体渲染。要替换中文字体需要走全局 `defaultFont` 或未来的 `fontMap` 选项。

## 分页

支持三种触发器，编译为 OOXML `<w:br w:type="page"/>`，Word/WPS 中正常分页：

### 1. `<page-break>` 自定义标签

```html
<p>第一页内容</p>
<page-break>
<p>第二页内容</p>
```

伪自闭合写法 `<page-break/>` 与 `<page-break />` 也能识别。可以放在段内（与文本同段）：

```html
<p>上半段<page-break/>下半段在新一页继续。</p>
```

### 2. `<hr class="page-break">` 替代横线为分页

```html
<p>章节一</p>
<hr class="page-break">
<p>章节二</p>
```

class 列表中包含 `page-break` token 即触发（`<hr class="foo page-break bar">` 也行）；近似名 `page-break-x` 不会误触。普通 `<hr>` 仍画水平线，行为不变。

### 3. CSS `page-break-before/after` 与 CSS3 `break-before/after`

挂在任何块级元素的 inline style 上：

```html
<h2 style="page-break-before: always">新章节</h2>
<p>内容...</p>
<p style="page-break-after: always">小节末段</p>
```

强制分页取值识别：legacy `always` / `left` / `right`；CSS3 `page` / `left` / `right` / `recto` / `verso` / `always` / `all`。`auto` / `avoid` 等值不触发。

> 同时声明 before + after 时按 CSS 标准插两次分页（元素之前一次，之后一次）。

## 数学公式（MathML → OMML）

`<math>` 标签会被转换成 OOXML Math（OMML）真实嵌入文档，Word/WPS 中可正常预览与编辑。

```html
<!-- 行内：与文本同段 -->
<p>勾股定理 <math><msup><mi>a</mi><mn>2</mn></msup><mo>+</mo>...</math>。</p>

<!-- 块级：独立成段，居中（Word 对显示式公式的默认行为） -->
<math display="block">
  <mfrac>
    <mrow>...</mrow>
    <mrow>...</mrow>
  </mfrac>
</math>
```

### 启用方式

数学转换依赖第三方包 [`mathml2omml`](https://www.npmjs.com/package/mathml2omml)（**LGPL-3.0-or-later**），作为 **optional peerDependency** 提供。需要数学公式时手动安装：

```bash
npm install mathml2omml
```

未安装时，`<math>` 会退回到 `[math]` 文本占位，并在首次出现时控制台 warn 一次（不会让整个转换失败）。

### 行为细节

- 默认按 HTML5 phrasing content 处理：`<math>...</math>` 是行内的，与前后文字共享段落
- 升级到块级需要显式 `display="block"`：在 `<m:oMathPara>` 中独占一段
- 同一段 MathML 在文档中重复出现时只转换一次（按字符串去重）

### 浏览器打包

由于动态 `await import('mathml2omml')`，部分构建工具默认不会把 optional peer 打进 bundle。如果你的浏览器场景需要数学公式：

- **Vite / Rollup**：直接 `npm install mathml2omml` 后即可，运行时被打入。
- **Webpack**：可能需要在 `optimization.splitChunks` 或异步 chunk 配置里允许动态 import。

不需要数学公式的浏览器场景可以放心忽略——动态 import 失败会被库内部捕获并退回占位。

## API 速查

```ts
import { htmlToDocx, htmlToDocument } from 'wp-html-to-docx'
import type { HtmlToDocxOptions } from 'wp-html-to-docx'

declare function htmlToDocx(
  html: string,
  options?: HtmlToDocxOptions,
): Promise<Uint8Array>

declare function htmlToDocument(
  html: string,
  options?: HtmlToDocxOptions,
): Promise<import('docx').Document>
```

## 浏览器打包提示

`docx` 依赖 `jszip`，部分构建工具（如 Vite）可能需要补 polyfill：

```ts
// vite.config.ts
export default {
  define: { global: 'globalThis' },
  // 如有报错可加: optimizeDeps.include: ['buffer']
}
```

## 开发

```bash
npm install
npm run typecheck    # 类型检查
npm test             # 双环境（node + jsdom）测试
npm run coverage     # 测试覆盖率
npm run build        # 编译到 dist/
```

## License

MIT
