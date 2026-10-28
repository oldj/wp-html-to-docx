# Changelog

本项目所有显著变更都会记录在本文件中。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- 列表编号层级方案：嵌套列表的项目符号 / 编号按深度三级一循环（`ul`：• ◦ ▪；`ol`：1. a. i.），与 Word / Google Docs 及 WonderPen 各渲染场景一致；此前所有层级都是 `•` 与 `1.`。
- 单个列表指定格式：读取 `data-list-style` / `style="list-style-type"` / HTML `type` 属性（按此优先级），映射到 OOXML `numFmt`，支持十进制、字母、罗马与三种中文数字（`cjk-decimal` / `simp-chinese-informal` / `trad-chinese-informal`，顿号后缀）及 `none`；指定格式只作用于该列表所在的层，其内嵌套的未指定列表仍按默认方案。
- `<ol start="N">`：起始序号写入 numbering 定义，此前被忽略、一律从 1 起。
- 新选项 `listLevels`：整体替换层级默认方案（`ordered` / `bullet` 各一组按深度循环的 `list-style-type` 关键字），供宿主把全局编号设置传进来；非法项跳过并 `warn`，整组非法回退默认。
- 表格列宽：读取 `<colgroup>` / `<col>` 的列宽（`style="width"` 与遗留属性 `width` 均可，支持 `%` / `px` / `pt` 等单位与 `span`），转成 OOXML `<w:tblGrid>` + `<w:tblLayout w:type="fixed">`，手工调过的列比例现在能保留到 Word；此前列宽被丢弃、一律由 Word 等分。列宽不完整或列数与网格对不上时退回等分，不写出错位的网格。
- 上标 / 下标：`<sub>` / `<sup>` 现在真正产生上下标效果（OOXML `<w:vertAlign>`）。此前二者虽被识别为内联标签却无对应样式映射，仅当普通文本透传。带 `wp-footnote-ref` / `footnote-ref` class 的脚注引用 `<sup>` 不受影响，仍走脚注路径。
- 脚注：自动识别「脚注引用 + 文末定义」结构（兼容 WonderPen 的 `<sup class="wp-footnote-ref">` / `<div class="footnotes">` 与 markdown-it 的 `footnote-ref` / `<section class="footnotes">`），转换为 docx **原生页面底部脚注**（`FootnoteReferenceRun` + `Document.footnotes`，Word/WPS 自动编号、悬停可见）。回跳箭头 `footnote-backref` 自动剥离；文末定义容器不再作为正文渲染。无需配置，仅命中专用 class 才触发。
- 块级元素文本样式下发：`<p>` / `<h1>`–`<h6>` / `<li>` / `<td>` / `<blockquote>` / `<div>` 等块级元素自身 `style` 中的文本样式（color / font-size / font-weight 等「进阶 B」范围）现在沿「单链继承」下发给段内文本，此前这些样式被忽略。仍不做选择器 / specificity 等完整 cascade。
- HTML4 遗留属性 `align="..."`：`<p align="center">` 等老编辑器写法现在产生对齐效果；CSS `text-align` 优先级更高（与浏览器一致）。
- 表格单元格对齐：`<td>` / `<th>` 上的 `text-align` / `align` 下推到单元格内顶层段落。
- 图片格式防护：检测 docx 不支持的 WebP / SVG / AVIF / HEIC / TIFF / ICO（mime + magic bytes 双路识别），按 `onUnresolvedImage` 策略处理（默认 skip），不再伪装成 PNG 嵌入产生 Word 中显示红叉的坏图。
- `logger` 现在承接库内全部非致命 warning（未知纸张名、页码槽位冲突、公式转换失败、图片未嵌入原因等）；未提供 logger 时维持原有 console / 静默行为不变。
- 导出 `TableCellMargin` 类型（此前 `tableCellMargin` 选项的类型未公开导出）。

### Changed

- 表宽：`<table style="width: X%">` / `<table width="X%">` 现在写入 `<w:tblW w:type="pct">` 对应的百分比；此前一律忽略、按 100% 满宽输出。**这是可见的行为变化**——声明过百分比表宽的 HTML 转出来会比以前窄。未声明宽度或声明为绝对值（`600px`）时仍按 100% 满宽，与此前一致。

### Fixed

- 异类型嵌套（`ul` 里的 `ol`、`ol` 里的 `ul`）此前从 level 0 重新起算，内层与外层缩进相同、看不出层次；现在 level 一律等于嵌套深度，缩进逐层递增。
- 同一个 `<li>` 里出现多个子列表（如列表项内「子列表 → 说明段落 → 又一个子列表」）时，第二个及之后的子列表此前与第一个共用同一套编号，接着往下编（`b.`、`c.`）而不是重新从 `a.` 起；现在它们各自独立编号。
- 嵌套列表之后的延续内容（list-continuation）中的图片与公式此前不被预加载 / 转换，渲染期图片静默丢失、公式退化为 `[math]` 占位；现已修复。
- 脚注内容中的图片与公式同样因资源收集遗漏而丢失 / 退化；现已修复。
- `<th>` 表头单元格文本现在默认加粗并居中（与浏览器渲染及表格模块注释宣称的行为一致），显式样式 / 对齐可覆盖；此前只有灰底没有加粗。
- 嵌套 `<blockquote>` 现在逐层叠加缩进（720 twip / 层），此前嵌套层与父层缩进相同、看不出层次。
- 页眉页脚三栏（left / center / right）的制表位现在按实际版心宽度计算；此前写死为 A4 默认版心（4513 / 9026 twip），横向、A3 等大纸张或自定义左右边距时右栏会落在页面中部。
- 列表内的表格（无 `<colgroup>`）现在写出「版心 − 列表缩进」的绝对表宽，网格随之收窄；此前表宽为 auto，docx 9.15 会按整个版心推导列宽，Google Docs / Pages / LibreOffice 等以网格为准的软件里表格会溢出右边距一个缩进量。表格单元格内的列表表格维持 auto。
- 未知纸张名（如 `page.size: 'A6'`）现在只告警一次；此前图片尺寸换算逐段、表格宽度逐表重新解析纸张，同一个配置错误会按段落数重复告警。
- KaTeX 渲染的公式（默认 `htmlAndMathml` 输出）不再在公式后混入 `.katex-html` 排版层拍平出的乱字符（如 `E=mc2`、`∫01x2dx=31` 与零宽空格），只取 `.katex-mathml` 里的 MathML；KaTeX 纯 HTML 输出仍按文本保留。
- `display="block"` 的公式被包在段落里且段内无其他文字时（如 KaTeX 的 `<p class="katex-block"><span class="katex-display">`），现在独占一段渲染为 `<m:oMathPara>`；此前按行内公式排版。
- 带 TeX 源码（`<annotation encoding="application/x-tex">`，KaTeX 默认输出就有）的公式改为优先用 docx 自带的 `docx/math`（MIT，`latexToMath`）转换，按需动态加载；失败再退回 `mathml2omml`，仍失败输出 `$…$` / `$$…$$` 文本。此前只能走 `mathml2omml`，未安装时一律是 `[math]` 占位。**即使已安装 `mathml2omml`，KaTeX 公式的输出也会变化**：此前积分、求和的主体为空（Word 中显示为虚线占位框，作用对象被挤到运算符之外），矩阵、分段函数的括号不随内容伸缩，现在这些结构都能正确还原。只用 KaTeX 的场景因此也无需安装 LGPL 的 `mathml2omml`，不再被提示安装它。
- `mathml2omml` 转换前剥离 `<annotation>` / `<annotation-xml>`，不再对带这些标签的公式往控制台打印 `Type not supported: annotation`。
- 链接文字现在挂 Word 内置的 `Hyperlink` 字符样式（蓝色 + 下划线）；此前链接可点击但外观与正文无异。显式 `color` 等内联样式仍优先。

## [0.2.0] - 2026-05-01

### Added

- `language` 选项：暴露文档级语言（`value` / `eastAsia` / `bidirectional`），注入 `styles.xml` 的 `<w:rPrDefault><w:lang>`，影响 Word 拼写检查 / 校对语言归属与东亚字体回退。
- `preserveWhitespace` 选项（默认关闭）：开启后保留文本中连续的半角空格、全角空格 U+3000、NBSP 等可见空白；含换行 / Tab 的空白序列仍折叠为单空格，避免格式化 HTML 源里的缩进/换行被当成内容。`<pre>` 块本就完全保留，不受此选项影响。

### Changed

- **BREAKING**：自定义分页标签由 `<page-break>` 重命名为 `<wp-page-break>`，与项目命名空间一致；不再支持旧标签。`<hr class="page-break">` class 名与 CSS `page-break-before/after` 属性名不变。

## [0.1.0] - 2026-04-28

首个公开版本，浏览器与 Node.js 双端运行。

### Added

- 基础 HTML → DOCX 转换：段落、标题（h1–h6）、强调（strong / em / u / s / sub / sup / code / mark）、链接、换行
- 列表：有序 / 无序 / 嵌套，自动复用 numbering
- 表格：合并单元格（rowspan / colspan）、表头、对齐、边框、表格内嵌套块
- 图片：`<img>` data URL 与 http(s) URL，自动探测尺寸；支持 PNG / JPEG / GIF / BMP
- 页面级 Options：纸张大小、纸张方向、页边距、默认字体与字号、文档元数据（title / creator / description / subject / keywords / lastModifiedBy）
- 分页支持：自定义 `<page-break>` 标签（含三种闭合写法）、`<hr class="page-break">` 替代横线、CSS `page-break-before/after` 与 CSS3 `break-before/after`；行内 `<page-break>` 在段内产生 PageBreak run
- 进阶 B - 内联 style 映射：color / background / font-size / font-family / font-weight / font-style / text-decoration / text-align
- 进阶 A - MathML → OMML 真实转换：`mathml2omml` 作为可选 peer 依赖动态加载，缺失时退回 `[math]` 占位；块级公式包 `<m:oMathPara>`，相同 MathML 多次出现去重
- 双层 API：`htmlToDocxBuffer(html, options)` 一步拿 `Uint8Array`；`htmlToDocument(html, options)` 返回 `docx.Document` 便于自由组合

### Notes

- 要求 Node.js >= 24
- 测试矩阵：Vitest 双 env（node + jsdom），354 用例全过；lines 97.26% / branches 87.63% / functions 100%

[Unreleased]: https://github.com/oldj/wp-html-to-docx/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/oldj/wp-html-to-docx/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/oldj/wp-html-to-docx/releases/tag/v0.1.0
