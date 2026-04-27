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

  // 文档元数据
  title: '我的文档',
  creator: '作者',
  description: '描述',

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

**内联**：`strong/b`、`em/i`、`u`、`s/strike/del`、`code`（行内代码）、`a`、`span`、`br`、`img`

**行为细节**：

- HTML 空白默认折叠为单空格；`<pre>` 内保留所有空白与换行
- HTML 实体（`&amp;` `&lt;` `&nbsp;` `&#x4e2d;` 等）自动解码
- `<a>` 与内联格式可任意组合（如 `<a><strong>x</strong></a>`）

## 数学公式（MVP 占位）

当前版本识别 `<math>` 标签并在 IR 层保留原始 MathML 字符串，但渲染时输出 `[math]` 占位文本。完整的 MathML → OMML 转换在后续版本接入（计划用 [`mathml2omml`](https://www.npmjs.com/package/mathml2omml) + [`temml`](https://www.npmjs.com/package/temml)）。

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
