# wp-html-to-docx

[![CI](https://github.com/oldj/wp-html-to-docx/actions/workflows/ci.yml/badge.svg)](https://github.com/oldj/wp-html-to-docx/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/wp-html-to-docx.svg)](https://www.npmjs.com/package/wp-html-to-docx)
[![license](https://img.shields.io/npm/l/wp-html-to-docx.svg)](./LICENSE)

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
    size: 'A4', // 'A4' | 'A3' | 'A5' | 'Letter' | 'Legal' | 'Tabloid' | { width, height, unit }
    orientation: 'portrait', // 'portrait' | 'landscape'
    margin: {
      top: 25.4,
      right: 25.4,
      bottom: 25.4,
      left: 25.4,
      header: 12.7,
      footer: 12.7,
      unit: 'mm', // 'mm' | 'in' | 'pt'
    },
  },

  header: '报告标题', // 字符串 或 { left, center, right }
  footer: { left: '机密', right: '2026' },

  pageNumber: {
    enabled: true,
    start: 1, // 起始编号
    format: 'decimal', // 'decimal' | 'upperRoman' | 'lowerRoman' | 'upperLetter' | 'lowerLetter'
    position: 'footer-center', // header/footer × left/center/right 共 6 种位置
    template: '第 {PAGE} 页 / 共 {TOTAL} 页',
  },

  // 文档元数据（写入 docProps/core.xml，对应 OOXML core properties；
  // 在 Word 的「文件 → 信息」面板里可见与编辑）
  title: '我的文档', // dc:title
  creator: '张三', // dc:creator —— 即「作者」字段（Word UI 显示为 Author）
  description: '描述', // dc:description
  subject: '主题', // dc:subject
  keywords: '财报, 2026, Q4', // cp:keywords，逗号分隔
  lastModifiedBy: '李四', // cp:lastModifiedBy，未设置时 docx 库默认写入 "Un-named"

  // 默认字体（写入 styles.xml 的 <w:rPrDefault><w:rFonts/>）
  defaultFont: 'Calibri',
  defaultFontSize: 22, // 半磅，22 = 11pt

  // 文档级默认语言（写入 styles.xml 的 <w:rPrDefault><w:lang/>）
  // 影响 Word 的拼写检查 / 校对语言、East Asian 字体回退归属。
  // 不传时不写入 <w:lang>，由 Word 使用打开端的默认值。
  language: {
    value: 'en-US', // <w:lang w:val>      西文 / 默认校对语言
    eastAsia: 'zh-CN', // <w:lang w:eastAsia> 东亚字符语言（中文 Word 推荐）
    // bidirectional: 'ar-SA',         // <w:lang w:bidi>     复杂文种 / RTL（按需）
  },

  // 图片解析（见下文）
  imageResolver: undefined,
  onUnresolvedImage: 'skip', // 'skip' | 'placeholder' | 'error'

  // 表格默认单元格内边距（对应 OOXML <w:tblCellMar>，应用于所有单元格）
  // 不传时使用库内置默认：左右 5pt + 上下 2pt，避免 docx 默认 0 内边距导致单元格紧贴。
  // HTML <table cellpadding="N">（N 为像素）会覆盖此默认，作用于该表所有四边。
  // 当前不解析 td/th 上的 CSS padding。
  tableCellMargin: { top: 2, right: 5, bottom: 2, left: 5, unit: 'pt' },

  // 是否保留文本中的连续空格（含全角空格 U+3000、NBSP 等）
  // 含换行/Tab 的空白序列仍会折叠为单空格，避免格式化 HTML 源里的缩进/换行被当成内容
  preserveWhitespace: false,

  // 可选日志钩子。提供后，库在执行入口会以 'info' 级别打印一行版本号，
  // 便于排查"是不是装到了旧版"。不提供则完全静默。
  logger: (level, message, ...args) => {
    // level: 'debug' | 'info' | 'warn' | 'error'
    console[level === 'debug' ? 'log' : level](message, ...args)
  },
})
```

### 确认运行时版本

库导出常量 `VERSION`，与 `package.json` 同步（构建时自动生成）。两种确认方式：

```ts
import { VERSION, htmlToDocx } from 'wp-html-to-docx'

console.log(VERSION) // 直接读取

await htmlToDocx(html, {
  logger: (_level, msg) => console.log(msg),
}) // 控制台会出现：wp-html-to-docx v0.2.0
```

适合排查包管理器命中了缓存里的旧版、`npm link` 后忘了 `npm run build` 等情况。

### 图片处理

`<img>` 的 `src` 支持以下来源：

- **`data:` URL**（PNG/JPEG/GIF/BMP）：内置自动解码，无需配置
- **HTTP/HTTPS / 相对路径**：需要提供 `imageResolver`，由调用方决定如何加载

未提供 `imageResolver` 时，外链图片按 `onUnresolvedImage` 处理：

| 策略           | 行为                     |
| -------------- | ------------------------ |
| `skip`（默认） | 静默跳过，不输出任何内容 |
| `placeholder`  | 用 `alt` 文本占位        |
| `error`        | 抛出错误                 |

> **格式限制**：docx 只能嵌入 PNG / JPEG / GIF / BMP。检测到 WebP / SVG / AVIF / HEIC / TIFF / ICO（按 mime 与 magic bytes 双路识别）时同样走 `onUnresolvedImage` 策略，不会伪装成 PNG 嵌入产生 Word 里显示红叉的坏图。提供 `logger` 时，每张未嵌入的图片会输出一条 `warn` 说明原因。

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

**特殊**：`wp-page-break` 自定义标签（见 [分页](#分页)）；脚注引用 `<sup class="wp-footnote-ref">` 与文末 `<div class="footnotes">`（见 [脚注](#脚注)）

**行为细节**：

- HTML 空白默认折叠为单空格；`<pre>` 内保留所有空白与换行
- 设 `preserveWhitespace: true` 后，连续的半角/全角空格、NBSP 等保留原样；含换行/Tab 的空白仍折叠为单空格
- HTML 实体（`&amp;` `&lt;` `&nbsp;` `&#x4e2d;` 等）自动解码
- `<a>` 与内联格式可任意组合（如 `<a><strong>x</strong></a>`）
- `<li>` 内含多个 `<p>`（或块级 + 裸文本）时，合并为单个列表项段落，段间以软换行 `<w:br/>` 分隔。这样**编号 / 项目符号只在首段出现一次**，后续段在同一项内自动换行并对齐到列表文本起点（等同 Word 里的 Shift+Enter）。OOXML 的 `<w:p>` 一旦带 numbering 引用就必然产生新编号，所以无法用"独立段落"语义来表达"同一编号下多行"——这是 Word 列表语义的固有约束
- `<li>` 内的 `<table>` / `<pre>` / `<blockquote>` / `<hr>` 作为**独立块**输出，结构原样保留（表格的 `<tr>/<td>`、pre 的等宽与空白、blockquote 的左边线视觉等都不会被拍扁）。这些块会**跟随列表项的层级缩进**：
  - `<table>`：注入 `<w:tblInd>` 与列表层级一致的左缩进；同时把 `tblW` 从 `pct 100%` 切到 `auto`，避免缩进 + 满宽导致表格右溢出页面边距
  - `<pre>` / `<hr>`：每个段落带相同的 `w:left` 缩进
  - `<blockquote>`：自带 720 缩进与外层 list 缩进**叠加**（嵌套缩进语义自洽，level 0 下最终为 1440）
  - 缩进值由 list 层级决定（每层 720 twip），等同 list-item 的文本起点位置，与浏览器渲染 `<li><table>` 的直觉一致

## 内联 `style` 属性

支持 `<span style="...">` / `<p style="...">` 等元素上的常用 CSS 属性，自动叠加到对应 docx 样式。**不**实现完整的 CSS 选择器引擎、cascade 与 specificity——只解析直接出现在元素上的内联声明。

块级元素（`p` / `h1`–`h6` / `li` / `td` / `blockquote` / `div` 等）自身 `style` 中的文本样式会沿「单链继承」下发给段内文本（如 `<div style="color:red"><p>x</p></div>` 中的 `x` 为红色）——这是浏览器继承语义的轻量子集。

| CSS 属性                                    | docx 映射                         | 说明                                                                                                                     |
| ------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `color`                                     | `TextRun.color`                   | 命名色 / `#RGB` / `#RRGGBB` / `rgb()`                                                                                    |
| `background` / `background-color`           | `TextRun.shading`（CLEAR + fill） | 同上；只取首个颜色 token                                                                                                 |
| `font-size`                                 | `TextRun.size`                    | `pt` / `px` / `em` / `rem` / `%`；`em` 以 12pt 为基准                                                                    |
| `font-family`                               | `TextRun.font`                    | 取首项去引号                                                                                                             |
| `font-weight: bold` 或数值 ≥ 600            | `bold: true`                      | 仅加法（不会用 `normal` 取消父级 bold）                                                                                  |
| `font-style: italic`                        | `italics: true`                   | 同上                                                                                                                     |
| `text-decoration: underline / line-through` | `underline` / `strike`            | 支持多个值组合                                                                                                           |
| `text-align`（块级元素）                    | `Paragraph.alignment`             | left / right / center / justify；HTML4 遗留属性 `align="..."` 同样识别（CSS 优先）；`td`/`th` 上的对齐下推到单元格内段落 |

```html
<p style="text-align: center">
  <span style="color: #d33; background-color: yellow; font-size: 14pt"> 强调文本 </span>
</p>
```

> **CJK 字体提示**：docx 的 `<w:rFonts>` 只把 `font-family` 写入 `ascii` / `hAnsi` 槽位；`eastAsia` 槽不变，因此中文字符仍按 Word 默认中文字体渲染。要替换中文字体需要走全局 `defaultFont` 或未来的 `fontMap` 选项。

## 分页

支持三种触发器，编译为 OOXML `<w:br w:type="page"/>`，Word/WPS 中正常分页：

### 1. `<wp-page-break>` 自定义标签

```html
<p>第一页内容</p>
<wp-page-break> <p>第二页内容</p></wp-page-break>
```

伪自闭合写法 `<wp-page-break/>` 与 `<wp-page-break />` 也能识别。可以放在段内（与文本同段）：

```html
<p>上半段<wp-page-break />下半段在新一页继续。</p>
```

### 2. `<hr class="page-break">` 替代横线为分页

```html
<p>章节一</p>
<hr class="page-break" />
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
<p>
  勾股定理
  <math
    ><msup><mi>a</mi><mn>2</mn></msup
    ><mo>+</mo>...</math
  >。
</p>

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

## 脚注

检测到「脚注引用 + 文末定义」结构时，自动转换为 docx **原生页面底部脚注**（Word/WPS 中自动编号、悬停可见、打印时排在该页底部），而非把定义列表原样画在正文末尾。无需任何配置，零误伤：只有命中专用 class 才触发。

识别的结构（兼容 WonderPen 与 markdown-it 两种产物）：

- **引用**：`<sup class="wp-footnote-ref">` 或 `<sup class="footnote-ref">`，内含指向定义的锚点 `<a href="#fn-1">`
- **定义容器**：`<div class="footnotes">` 或 `<section class="footnotes">`，内部 `<ol><li id="fn-1">…</li></ol>`
- **回跳箭头**：`<a class="footnote-backref">↩</a>`（或 `href="#fnref…"`）自动剥离——Word 脚注靠引用标记导航，无需回跳链接

```html
<p>
  正文<sup class="wp-footnote-ref"><a href="#fn-1">[1]</a></sup
  >继续。
</p>
<div class="footnotes">
  <hr />
  <ol>
    <li id="fn-1">
      脚注内容，支持<strong>样式</strong>、<a href="https://example.com">链接</a>与 <br />
      软换行。<a href="#fnref-1" class="footnote-backref">↩</a>
    </li>
  </ol>
</div>
```

### 行为细节

- 引用处只输出 docx 脚注引用（`FootnoteReferenceRun`），原 `[1]` 占位文本被丢弃——编号由 Word 自动维护
- 编号按定义在文末列表中的出现顺序分配（`fn-1`→1、`fn-2`→2…）
- 文末定义容器**不再**作为正文渲染；容器自带的 `<hr>` 分隔线与 `<ol>` 编号交给 Word 处理
- 引用了不存在的定义时，安全跳过该引用（不报错）；普通 `<sup>`（无脚注 class）不受影响
- 脚注内容支持文本、内联样式、链接、`<br>` 软换行、`<img>` 图片与 `<math>` 公式（图片 / 公式与正文走同一套异步资源加载）

## API 速查

```ts
import { htmlToDocx, htmlToDocument } from 'wp-html-to-docx'
import type { HtmlToDocxOptions } from 'wp-html-to-docx'

declare function htmlToDocx(html: string, options?: HtmlToDocxOptions): Promise<Uint8Array>

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
