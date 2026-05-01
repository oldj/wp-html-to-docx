# Changelog

本项目所有显著变更都会记录在本文件中。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

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

[Unreleased]: https://github.com/oldj/wp-html-to-docx/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/oldj/wp-html-to-docx/releases/tag/v0.1.0
