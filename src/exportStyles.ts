export type ExportViewStyle = 'modern' | 'narrow' | 'cute' | 'xkcd' | 'print'
export type ExportFontSize = 'xs' | 's' | 'm' | 'l' | 'xl'
export type ExportSpacing = 'tight' | 'compact' | 'cozy' | 'wide'

interface ExportStyleTokens {
  bodyBackground: string
  bodyTextColor: string
  bodyLinkColor: string
  bodyBorderColor: string
  bodyBlockquoteBorderColor: string
  codeBackground: string
  codeBorderColor: string
  codeRadius: string
  textBorderColor: string
  textRadius: string
  previewFontFamily: string
  previewFontSize: string
  previewLineHeight: string
  previewPadding: string
  previewCodeFont: string
  previewInlineCodeSize: string
  previewInlineCodePadding: string
  previewHighlightedBackground: string
}

const defaultExportTokens: ExportStyleTokens = {
  bodyBackground: '#ffffff',
  bodyTextColor: '#000000',
  bodyLinkColor: '#00459edd',
  bodyBorderColor: '#00000044',
  bodyBlockquoteBorderColor: '#00000044',
  codeBackground: '#f2f2f2',
  codeBorderColor: '#dcdcdc',
  codeRadius: '6px',
  textBorderColor: '#dcdcdc',
  textRadius: '4px',
  previewFontFamily: 'Georgia, serif',
  previewFontSize: '16px',
  previewLineHeight: '1.6',
  previewPadding: '18px',
  previewCodeFont: 'Menlo, Monaco, monospace',
  previewInlineCodeSize: '0.95em',
  previewInlineCodePadding: '0.08em 0.35em',
  previewHighlightedBackground: 'rgba(255, 221, 105, 0.55)',
}

export const exportStyleMappingConfig: Record<keyof ExportStyleTokens, boolean> = {
  bodyBackground: false,
  bodyTextColor: true,
  bodyLinkColor: true,
  bodyBorderColor: true,
  bodyBlockquoteBorderColor: true,
  codeBackground: true,
  codeBorderColor: true,
  codeRadius: true,
  textBorderColor: true,
  textRadius: true,
  previewFontFamily: true,
  previewFontSize: true,
  previewLineHeight: true,
  previewPadding: true,
  previewCodeFont: true,
  previewInlineCodeSize: true,
  previewInlineCodePadding: true,
  previewHighlightedBackground: true,
}

function resolveCssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

function createPreviewMeasurementNode(viewStyle: ExportViewStyle, viewFontSize: ExportFontSize, viewSpacing: ExportSpacing): HTMLElement {
  const node = document.createElement('div')
  node.className = `markdown-preview style-${viewStyle} size-${viewFontSize} spacing-${viewSpacing}`
  node.style.position = 'absolute'
  node.style.visibility = 'hidden'
  node.style.left = '-99999px'
  node.style.top = '-99999px'
  node.style.pointerEvents = 'none'
  node.textContent = 'preview'
  document.body.appendChild(node)
  return node
}

function resolveExportTokens(
  viewStyle: ExportViewStyle,
  viewFontSize: ExportFontSize,
  viewSpacing: ExportSpacing,
): ExportStyleTokens {
  const previewNode = createPreviewMeasurementNode(viewStyle, viewFontSize, viewSpacing)
  const computed = getComputedStyle(previewNode)

  const resolvedTokens: ExportStyleTokens = {
    bodyBackground: resolveCssVar('--color-background-light', defaultExportTokens.bodyBackground),
    bodyTextColor: resolveCssVar('--color-text-dark', defaultExportTokens.bodyTextColor),
    bodyLinkColor: resolveCssVar('--color-text-link', defaultExportTokens.bodyLinkColor),
    bodyBorderColor: resolveCssVar('--color-border-hr', defaultExportTokens.bodyBorderColor),
    bodyBlockquoteBorderColor: resolveCssVar('--color-border-blockquote', defaultExportTokens.bodyBlockquoteBorderColor),
    codeBackground: resolveCssVar('--btn-bg-default', defaultExportTokens.codeBackground),
    codeBorderColor: resolveCssVar('--btn-border-default', defaultExportTokens.codeBorderColor),
    codeRadius: resolveCssVar('--border-radius-regular', defaultExportTokens.codeRadius),
    textBorderColor: resolveCssVar('--btn-border-default', defaultExportTokens.textBorderColor),
    textRadius: resolveCssVar('--border-radius-small', defaultExportTokens.textRadius),
    previewFontFamily: computed.fontFamily || defaultExportTokens.previewFontFamily,
    previewFontSize: computed.fontSize || defaultExportTokens.previewFontSize,
    previewLineHeight: computed.lineHeight || defaultExportTokens.previewLineHeight,
    previewPadding: computed.getPropertyValue('--preview-edge-padding').trim() || defaultExportTokens.previewPadding,
    previewCodeFont: computed.getPropertyValue('--preview-code-font').trim() || defaultExportTokens.previewCodeFont,
    previewInlineCodeSize: computed.getPropertyValue('--preview-inline-code-size').trim() || defaultExportTokens.previewInlineCodeSize,
    previewInlineCodePadding: computed.getPropertyValue('--preview-inline-code-padding').trim() || defaultExportTokens.previewInlineCodePadding,
    previewHighlightedBackground: resolveCssVar('--preview-edge-fade-color', defaultExportTokens.previewHighlightedBackground),
  }

  const tokens: ExportStyleTokens = {
    bodyBackground: exportStyleMappingConfig.bodyBackground ? resolvedTokens.bodyBackground : defaultExportTokens.bodyBackground,
    bodyTextColor: exportStyleMappingConfig.bodyTextColor ? resolvedTokens.bodyTextColor : defaultExportTokens.bodyTextColor,
    bodyLinkColor: exportStyleMappingConfig.bodyLinkColor ? resolvedTokens.bodyLinkColor : defaultExportTokens.bodyLinkColor,
    bodyBorderColor: exportStyleMappingConfig.bodyBorderColor ? resolvedTokens.bodyBorderColor : defaultExportTokens.bodyBorderColor,
    bodyBlockquoteBorderColor: exportStyleMappingConfig.bodyBlockquoteBorderColor ? resolvedTokens.bodyBlockquoteBorderColor : defaultExportTokens.bodyBlockquoteBorderColor,
    codeBackground: exportStyleMappingConfig.codeBackground ? resolvedTokens.codeBackground : defaultExportTokens.codeBackground,
    codeBorderColor: exportStyleMappingConfig.codeBorderColor ? resolvedTokens.codeBorderColor : defaultExportTokens.codeBorderColor,
    codeRadius: exportStyleMappingConfig.codeRadius ? resolvedTokens.codeRadius : defaultExportTokens.codeRadius,
    textBorderColor: exportStyleMappingConfig.textBorderColor ? resolvedTokens.textBorderColor : defaultExportTokens.textBorderColor,
    textRadius: exportStyleMappingConfig.textRadius ? resolvedTokens.textRadius : defaultExportTokens.textRadius,
    previewFontFamily: exportStyleMappingConfig.previewFontFamily ? resolvedTokens.previewFontFamily : defaultExportTokens.previewFontFamily,
    previewFontSize: exportStyleMappingConfig.previewFontSize ? resolvedTokens.previewFontSize : defaultExportTokens.previewFontSize,
    previewLineHeight: exportStyleMappingConfig.previewLineHeight ? resolvedTokens.previewLineHeight : defaultExportTokens.previewLineHeight,
    previewPadding: exportStyleMappingConfig.previewPadding ? resolvedTokens.previewPadding : defaultExportTokens.previewPadding,
    previewCodeFont: exportStyleMappingConfig.previewCodeFont ? resolvedTokens.previewCodeFont : defaultExportTokens.previewCodeFont,
    previewInlineCodeSize: exportStyleMappingConfig.previewInlineCodeSize ? resolvedTokens.previewInlineCodeSize : defaultExportTokens.previewInlineCodeSize,
    previewInlineCodePadding: exportStyleMappingConfig.previewInlineCodePadding ? resolvedTokens.previewInlineCodePadding : defaultExportTokens.previewInlineCodePadding,
    previewHighlightedBackground: exportStyleMappingConfig.previewHighlightedBackground ? resolvedTokens.previewHighlightedBackground : defaultExportTokens.previewHighlightedBackground,
  }

  document.body.removeChild(previewNode)
  return tokens
}

export function buildExportCss(
  viewStyle: ExportViewStyle,
  viewFontSize: ExportFontSize,
  viewSpacing: ExportSpacing,
): string {
  const tokens = resolveExportTokens(viewStyle, viewFontSize, viewSpacing)

  return `
html, body {
  margin: 0;
  padding: 0;
  min-height: auto;
  height: auto;
  overflow: visible;
  background: ${tokens.bodyBackground};
  color: ${tokens.bodyTextColor};
  font-family: ${tokens.previewFontFamily};
  font-size: ${tokens.previewFontSize};
  line-height: ${tokens.previewLineHeight};
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
  background: ${tokens.bodyBackground};
  color: ${tokens.bodyTextColor};
  margin: 0 auto;
  overflow: visible;
}

.markdown-preview {
  width: 100%;
  height: auto;
  overflow: visible;
  padding: ${tokens.previewPadding};
  box-sizing: border-box;
  color: ${tokens.bodyTextColor};
  text-shadow: none;
}

.markdown-preview > *:not(.markdown-preview-texture),
.markdown-preview > *:not(.markdown-preview-background) {
  position: relative;
  z-index: 1;
}

.markdown-preview .search-hit {
  background-color: ${tokens.previewHighlightedBackground};
  color: inherit;
  border-radius: ${tokens.textRadius};
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
  color: ${tokens.bodyTextColor};
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
  color: ${tokens.bodyLinkColor};
  text-decoration: underline;
  text-underline-offset: 2px;
}

.markdown-preview em,
.markdown-preview i {
  font-style: italic;
}

.markdown-preview code {
  font-family: ${tokens.previewCodeFont};
  font-size: ${tokens.previewInlineCodeSize};
  background: ${tokens.codeBackground};
  border: 1px solid ${tokens.codeBorderColor};
  border-radius: ${tokens.textRadius};
  padding: ${tokens.previewInlineCodePadding};
}

.markdown-preview pre {
  background: ${tokens.codeBackground};
  border: 1px solid ${tokens.codeBorderColor};
  border-radius: ${tokens.codeRadius};
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
  border-left: 3px solid ${tokens.bodyBlockquoteBorderColor};
  padding-left: 10px;
  letter-spacing: 0.1em;
  font-size: 0.94em;
  color: ${tokens.bodyTextColor};
}

.markdown-preview hr {
  border: none;
  border-top: 1px solid ${tokens.bodyBorderColor};
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
  background: ${tokens.bodyBackground};
  border-radius: ${tokens.codeRadius};
  overflow: hidden;
}

.markdown-preview th,
.markdown-preview td {
  border: 1px solid ${tokens.codeBorderColor};
  padding: 6px 8px;
  text-align: left;
}

.markdown-preview img {
  max-width: 100%;
  height: auto;
  border-radius: ${tokens.codeRadius};
}

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
`}
