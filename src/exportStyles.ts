export type ExportViewStyle = 'modern' | 'narrow' | 'cute' | 'xkcd' | 'print'
export type ExportFontSize = 'xs' | 's' | 'm' | 'l' | 'xl'
export type ExportSpacing = 'tight' | 'compact' | 'cozy' | 'wide'

const baseExportCss = `
html, body {
  margin: 0;
  padding: 0;
  min-height: auto;
  height: auto;
  overflow: visible;
  background: #ffffff;
  color: #000000;
  font-family: 'Times New Roman', Georgia, serif;
  font-size: 16px;
}

@page {
  size: A4;
  margin: 12mm;
}

body {
  -webkit-print-color-adjust: exact;
}

.pdf-exporter-page {
  width: 210mm;
  max-width: 210mm;
  min-height: auto;
  padding: 12mm;
  box-sizing: border-box;
  background: #ffffff;
  color: #000000;
  margin: 0 auto;
  overflow: visible;
}

.markdown-preview {
  width: 100%;
  height: auto;
  overflow: visible;
  padding: 0;
  box-sizing: border-box;
  color: #1f1f1f;
  text-shadow: none;
  position: relative;
}

.markdown-preview > *:not(.markdown-preview-texture),
.markdown-preview > *:not(.markdown-preview-background) {
  position: relative;
  z-index: 1;
}

.markdown-preview .search-hit {
  background-color: rgba(255, 221, 105, 0.55);
  color: inherit;
  border-radius: 8px;
  outline: 1px solid rgba(0, 0, 0, 0.14);
  padding: 4px;
}

.markdown-preview h1,
.markdown-preview h2,
.markdown-preview h3,
.markdown-preview h4,
.markdown-preview h5,
.markdown-preview h6 {
  margin: 0.75em 0 0.45em;
  line-height: 1.25;
  color: #1f1f1f;
  text-shadow: none;
}

.markdown-preview h1 { font-size: 1.9em; }
.markdown-preview h2 { font-size: 1.55em; }
.markdown-preview h3 { font-size: 1.28em; }

.markdown-preview p,
.markdown-preview ul,
.markdown-preview ol,
.markdown-preview blockquote,
.markdown-preview pre,
.markdown-preview table {
  margin: 0.55em 0;
}

.markdown-preview > *:first-child {
  margin-top: 0;
}

.markdown-preview a {
  color: #1a66cc;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.markdown-preview em,
.markdown-preview i {
  font-style: italic;
}

.markdown-preview code {
  font-family: 'Red Hat Mono', 'Syne Mono', 'Menlo', 'Monaco', monospace;
  font-size: 0.95em;
  background: #f2f2f2;
  border: 1px solid #dcdcdc;
  border-radius: 4px;
  padding: 0.08em 0.35em;
}

.markdown-preview pre {
  background: #f2f2f2;
  border: 1px solid #dcdcdc;
  border-radius: 8px;
  padding: 12px;
  overflow-x: auto;
}

.markdown-preview pre code {
  border: none;
  background: transparent;
  font-size: 1em;
  padding: 0;
}

.markdown-preview blockquote {
  border-left: 3px solid #b0b0b0;
  padding-left: 10px;
  letter-spacing: 0.1em;
  font-size: 0.94em;
  color: #555555;
}

.markdown-preview hr {
  border: none;
  border-top: 1px solid #cccccc;
  margin: 0.8em 0;
}

.markdown-preview ul,
.markdown-preview ol {
  padding-left: 1.35em;
}

.markdown-preview ul { list-style-type: disc; }
.markdown-preview ol { list-style-type: decimal; }
.markdown-preview li { display: list-item; }

.markdown-preview ul ul { list-style-type: circle; }
.markdown-preview ul ul ul { list-style-type: square; }
.markdown-preview ol ol { list-style-type: lower-alpha; }
.markdown-preview ol ol ol { list-style-type: lower-roman; }

.markdown-preview table {
  width: 100%;
  border-collapse: collapse;
  background: #f8f8f8;
  border-radius: 8px;
  overflow: hidden;
}

.markdown-preview th,
.markdown-preview td {
  border: 1px solid #dcdcdc;
  padding: 6px 8px;
  text-align: left;
}

.markdown-preview img {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
}

.markdown-preview.style-modern {
  font-family: 'Quicksand', 'Segoe UI', sans-serif;
}

.markdown-preview.style-narrow {
  font-family: 'Roboto Condensed', 'Segoe UI', sans-serif;
}

.markdown-preview.style-cute {
  font-family: 'Sour Gummy', 'Quicksand', 'Segoe UI', sans-serif;
}

.markdown-preview.style-xkcd {
  font-family: 'xkcd', 'Comic Sans MS', 'Chalkboard SE', cursive;
}

.markdown-preview.style-print {
  font-family: 'Big Shoulders', 'Times New Roman', Georgia, serif;
  font-weight: 400;
}

.markdown-preview.size-xs { font-size: 12px; }
.markdown-preview.size-s { font-size: 14px; }
.markdown-preview.size-m { font-size: 16px; }
.markdown-preview.size-l { font-size: 18px; }
.markdown-preview.size-xl { font-size: 20px; }

.markdown-preview.spacing-tight { line-height: 1.2; }
.markdown-preview.spacing-compact { line-height: 1.4; }
.markdown-preview.spacing-cozy { line-height: 1.6; }
.markdown-preview.spacing-wide { line-height: 1.8; }

.markdown-preview h1,
.markdown-preview h2,
.markdown-preview h3,
.markdown-preview h4,
.markdown-preview h5,
.markdown-preview h6,
.markdown-preview p,
.markdown-preview ul,
.markdown-preview ol,
.markdown-preview blockquote,
.markdown-preview pre,
.markdown-preview table,
.markdown-preview li {
  page-break-inside: avoid;
  break-inside: avoid;
  orphans: 2;
  widows: 2;
}
`

const styleVariantCss: Record<ExportViewStyle, string> = {
  modern: `.markdown-preview { font-family: 'Quicksand', 'Segoe UI', sans-serif; }`,
  narrow: `.markdown-preview { font-family: 'Roboto Condensed', 'Segoe UI', sans-serif; }`,
  cute: `.markdown-preview { font-family: 'Sour Gummy', 'Quicksand', 'Segoe UI', sans-serif; }`,
  xkcd: `.markdown-preview { font-family: 'xkcd', 'Comic Sans MS', 'Chalkboard SE', cursive; }`,
  print: `.markdown-preview { font-family: 'Big Shoulders', 'Times New Roman', Georgia, serif; font-weight: 400; }`,
}

const sizeVariantCss: Record<ExportFontSize, string> = {
  xs: `.markdown-preview { font-size: 12px; }`,
  s: `.markdown-preview { font-size: 14px; }`,
  m: `.markdown-preview { font-size: 16px; }`,
  l: `.markdown-preview { font-size: 18px; }`,
  xl: `.markdown-preview { font-size: 20px; }`,
}

const spacingVariantCss: Record<ExportSpacing, string> = {
  tight: `.markdown-preview { line-height: 1.2; }`,
  compact: `.markdown-preview { line-height: 1.4; }`,
  cozy: `.markdown-preview { line-height: 1.6; }`,
  wide: `.markdown-preview { line-height: 1.8; }`,
}

export function buildExportCss(
  viewStyle: ExportViewStyle,
  viewFontSize: ExportFontSize,
  viewSpacing: ExportSpacing,
): string {
  return [
    baseExportCss,
    styleVariantCss[viewStyle],
    sizeVariantCss[viewFontSize],
    spacingVariantCss[viewSpacing],
  ].join('\n')
}
