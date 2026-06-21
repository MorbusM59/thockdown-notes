export type ExportViewStyle = 'modern' | 'narrow' | 'cute' | 'xkcd' | 'print'
export type ExportFontSize = 'xs' | 's' | 'm' | 'l' | 'xl'
export type ExportSpacing = 'tight' | 'compact' | 'cozy' | 'wide'

interface ExportStyleTokens {
  bodyBackground: string
  bodyTextColor: string
  bodyLinkColor: string
  bodyBorderColor: string
  bodyBlockquoteBorderColor: string
  bodyBlockquoteColor: string
  codeBackground: string
  codeBorderColor: string
  codeRadius: string
  textBorderColor: string
  textRadius: string
  previewFontFamily: string
  previewFontSize: string
  previewFontWeight: string
  previewLineHeight: string
  previewLetterSpacing: string
  previewFontSynthesis: string
  previewTextShadow: string
  previewPadding: string
  previewCodeFont: string
  previewInlineCodeSize: string
  previewInlineCodePadding: string
  previewHighlightedBackground: string
  headingTextShadow: string
  heading1FontSize: string
  heading2FontSize: string
  heading3FontSize: string
  heading4FontSize: string
  heading5FontSize: string
  heading6FontSize: string
  heading1FontWeight: string
  heading2FontWeight: string
  heading3FontWeight: string
  heading4FontWeight: string
  heading5FontWeight: string
  heading6FontWeight: string
  heading1FontStyle: string
  heading2FontStyle: string
  heading3FontStyle: string
  heading4FontStyle: string
  heading5FontStyle: string
  heading6FontStyle: string
  heading1LetterSpacing: string
  heading2LetterSpacing: string
  heading3LetterSpacing: string
  heading4LetterSpacing: string
  heading5LetterSpacing: string
  heading6LetterSpacing: string
  heading1TextShadow: string
  heading2TextShadow: string
  heading3TextShadow: string
  heading4TextShadow: string
  heading5TextShadow: string
  heading6TextShadow: string
}

const defaultExportTokens: ExportStyleTokens = {
  bodyBackground: '#ffffff',
  bodyTextColor: '#000000',
  bodyLinkColor: '#00459edd',
  bodyBorderColor: '#00000044',
  bodyBlockquoteBorderColor: '#00000044',
  bodyBlockquoteColor: '#000000BB',
  codeBackground: '#f2f2f2',
  codeBorderColor: '#dcdcdc',
  codeRadius: '6px',
  textBorderColor: '#dcdcdc',
  textRadius: '4px',
  previewFontFamily: 'Georgia, serif',
  previewFontSize: '16px',
  previewFontWeight: '400',
  previewLineHeight: '1.6',
  previewLetterSpacing: 'normal',
  previewFontSynthesis: 'none',
  previewTextShadow: 'none',
  previewPadding: '18px',
  previewCodeFont: 'Menlo, Monaco, monospace',
  previewInlineCodeSize: '0.95em',
  previewInlineCodePadding: '0.08em 0.35em',
  previewHighlightedBackground: 'rgba(255, 221, 105, 0.55)',
  headingTextShadow: 'none',
  heading1FontSize: '1.9em',
  heading2FontSize: '1.55em',
  heading3FontSize: '1.28em',
  heading4FontSize: '1em',
  heading5FontSize: '1em',
  heading6FontSize: '1em',
  heading1FontWeight: 'inherit',
  heading2FontWeight: 'inherit',
  heading3FontWeight: 'inherit',
  heading4FontWeight: 'inherit',
  heading5FontWeight: 'inherit',
  heading6FontWeight: 'inherit',
  heading1FontStyle: 'normal',
  heading2FontStyle: 'normal',
  heading3FontStyle: 'normal',
  heading4FontStyle: 'normal',
  heading5FontStyle: 'normal',
  heading6FontStyle: 'normal',
  heading1LetterSpacing: 'normal',
  heading2LetterSpacing: 'normal',
  heading3LetterSpacing: 'normal',
  heading4LetterSpacing: 'normal',
  heading5LetterSpacing: 'normal',
  heading6LetterSpacing: 'normal',
  heading1TextShadow: 'none',
  heading2TextShadow: 'none',
  heading3TextShadow: 'none',
  heading4TextShadow: 'none',
  heading5TextShadow: 'none',
  heading6TextShadow: 'none',
}

export const exportStyleMappingConfig: Record<keyof ExportStyleTokens, boolean> = {
  bodyBackground: false,
  bodyTextColor: true,
  bodyLinkColor: true,
  bodyBorderColor: true,
  bodyBlockquoteBorderColor: true,
  bodyBlockquoteColor: true,
  codeBackground: true,
  codeBorderColor: true,
  codeRadius: true,
  textBorderColor: true,
  textRadius: true,
  previewFontFamily: true,
  previewFontSize: true,
  previewFontWeight: true,
  previewLineHeight: true,
  previewLetterSpacing: true,
  previewFontSynthesis: true,
  previewTextShadow: true,
  previewPadding: true,
  previewCodeFont: true,
  previewInlineCodeSize: true,
  previewInlineCodePadding: true,
  previewHighlightedBackground: true,
  headingTextShadow: true,
  heading1FontSize: true,
  heading2FontSize: true,
  heading3FontSize: true,
  heading4FontSize: true,
  heading5FontSize: true,
  heading6FontSize: true,
  heading1FontWeight: true,
  heading2FontWeight: true,
  heading3FontWeight: true,
  heading4FontWeight: true,
  heading5FontWeight: true,
  heading6FontWeight: true,
  heading1FontStyle: true,
  heading2FontStyle: true,
  heading3FontStyle: true,
  heading4FontStyle: true,
  heading5FontStyle: true,
  heading6FontStyle: true,
  heading1LetterSpacing: true,
  heading2LetterSpacing: true,
  heading3LetterSpacing: true,
  heading4LetterSpacing: true,
  heading5LetterSpacing: true,
  heading6LetterSpacing: true,
  heading1TextShadow: true,
  heading2TextShadow: true,
  heading3TextShadow: true,
  heading4TextShadow: true,
  heading5TextShadow: true,
  heading6TextShadow: true,
}

function resolveCssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

function resolveExportFontUrl(relativePath: string): string {
  return new URL(relativePath, import.meta.url).href
}

function buildExportFontFaceCss(): string {
  return `
@font-face {
  font-family: 'Syne Mono';
  src: url('${resolveExportFontUrl('./fonts/SyneMono-Regular.woff2')}') format('woff2');
  font-weight: normal;
  font-style: normal;
}

@font-face {
  font-family: 'Red Hat Mono';
  src: url('${resolveExportFontUrl('./fonts/RedHatMono-Regular.woff2')}') format('woff2');
  font-weight: normal;
  font-style: normal;
}

@font-face {
  font-family: 'Roboto Condensed';
  src: url('${resolveExportFontUrl('./fonts/RobotoCondensed-Regular.woff2')}') format('woff2');
  font-weight: 400;
  font-style: normal;
}

@font-face {
  font-family: 'Roboto Condensed';
  src: url('${resolveExportFontUrl('./fonts/RobotoCondensed-Medium.woff2')}') format('woff2');
  font-weight: 500;
  font-style: normal;
}

@font-face {
  font-family: 'Roboto Condensed';
  src: url('${resolveExportFontUrl('./fonts/RobotoCondensed-Bold.woff2')}') format('woff2');
  font-weight: 700;
  font-style: normal;
}

@font-face {
  font-family: 'Quicksand';
  src: url('${resolveExportFontUrl('./fonts/Quicksand-Regular.woff2')}') format('woff2');
  font-weight: 400;
  font-style: normal;
}

@font-face {
  font-family: 'Quicksand';
  src: url('${resolveExportFontUrl('./fonts/Quicksand-Medium.woff2')}') format('woff2');
  font-weight: 500;
  font-style: normal;
}

@font-face {
  font-family: 'Quicksand';
  src: url('${resolveExportFontUrl('./fonts/Quicksand-Bold.woff2')}') format('woff2');
  font-weight: 700;
  font-style: normal;
}

@font-face {
  font-family: 'Sour Gummy';
  src: url('${resolveExportFontUrl('./fonts/SourGummy-Regular.woff2')}') format('woff2');
  font-weight: 400;
  font-style: normal;
}

@font-face {
  font-family: 'Sour Gummy';
  src: url('${resolveExportFontUrl('./fonts/SourGummy-Medium.woff2')}') format('woff2');
  font-weight: 500;
  font-style: normal;
}

@font-face {
  font-family: 'Sour Gummy';
  src: url('${resolveExportFontUrl('./fonts/SourGummy-Bold.woff2')}') format('woff2');
  font-weight: 700;
  font-style: normal;
}

@font-face {
  font-family: 'Alumni Sans';
  src: url('${resolveExportFontUrl('./fonts/AlumniSans-Regular.woff2')}') format('woff2');
  font-weight: 400;
  font-style: normal;
}

@font-face {
  font-family: 'Big Shoulders';
  src: url('${resolveExportFontUrl('./fonts/BigShoulders-ExtraLight.woff2')}') format('woff2');
  font-weight: 200;
  font-style: normal;
}

@font-face {
  font-family: 'xkcd';
  src: url('${resolveExportFontUrl('./fonts/xkcd.otf')}') format('opentype');
  font-weight: 400;
  font-style: normal;
}

@font-face {
  font-family: 'Share Tech Mono';
  src: url('${resolveExportFontUrl('./fonts/ShareTechMono-Regular.woff2')}') format('woff2');
  font-weight: 400;
  font-style: normal;
}
`
}

function createPreviewMeasurementNode(viewStyle: ExportViewStyle, viewFontSize: ExportFontSize, viewSpacing: ExportSpacing): HTMLElement {
  const node = document.createElement('div')
  node.className = `markdown-preview style-${viewStyle} size-${viewFontSize} spacing-${viewSpacing}`
  node.style.position = 'absolute'
  node.style.visibility = 'hidden'
  node.style.left = '-99999px'
  node.style.top = '-99999px'
  node.style.pointerEvents = 'none'
  node.innerHTML = `
    <h1>preview</h1>
    <h2>preview</h2>
    <h3>preview</h3>
    <h4>preview</h4>
    <h5>preview</h5>
    <h6>preview</h6>
    <p>preview</p>
  `
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
  const h1 = getComputedStyle(previewNode.querySelector('h1')!)
  const h2 = getComputedStyle(previewNode.querySelector('h2')!)
  const h3 = getComputedStyle(previewNode.querySelector('h3')!)
  const h4 = getComputedStyle(previewNode.querySelector('h4')!)
  const h5 = getComputedStyle(previewNode.querySelector('h5')!)
  const h6 = getComputedStyle(previewNode.querySelector('h6')!)

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
    bodyBlockquoteColor: resolveCssVar('--color-text-faded', defaultExportTokens.bodyBlockquoteColor),
    previewFontFamily: computed.fontFamily || defaultExportTokens.previewFontFamily,
    previewFontSize: computed.fontSize || defaultExportTokens.previewFontSize,
    previewLineHeight: computed.lineHeight || defaultExportTokens.previewLineHeight,
    previewPadding: computed.getPropertyValue('--preview-edge-padding').trim() || defaultExportTokens.previewPadding,
    previewCodeFont: computed.getPropertyValue('--preview-code-font').trim() || defaultExportTokens.previewCodeFont,
    previewInlineCodeSize: computed.getPropertyValue('--preview-inline-code-size').trim() || defaultExportTokens.previewInlineCodeSize,
    previewInlineCodePadding: computed.getPropertyValue('--preview-inline-code-padding').trim() || defaultExportTokens.previewInlineCodePadding,
    previewLetterSpacing: computed.letterSpacing || defaultExportTokens.previewLetterSpacing,
    previewFontWeight: computed.fontWeight || defaultExportTokens.previewFontWeight,
    previewFontSynthesis: computed.fontSynthesis || defaultExportTokens.previewFontSynthesis,
    previewTextShadow: computed.textShadow || defaultExportTokens.previewTextShadow,
    previewHighlightedBackground: resolveCssVar('--preview-edge-fade-color', defaultExportTokens.previewHighlightedBackground),
    headingTextShadow: h1.textShadow || defaultExportTokens.headingTextShadow,
    heading1FontSize: h1.fontSize || defaultExportTokens.heading1FontSize,
    heading2FontSize: h2.fontSize || defaultExportTokens.heading2FontSize,
    heading3FontSize: h3.fontSize || defaultExportTokens.heading3FontSize,
    heading4FontSize: h4.fontSize || defaultExportTokens.heading4FontSize,
    heading5FontSize: h5.fontSize || defaultExportTokens.heading5FontSize,
    heading6FontSize: h6.fontSize || defaultExportTokens.heading6FontSize,
    heading1FontWeight: h1.fontWeight || defaultExportTokens.heading1FontWeight,
    heading2FontWeight: h2.fontWeight || defaultExportTokens.heading2FontWeight,
    heading3FontWeight: h3.fontWeight || defaultExportTokens.heading3FontWeight,
    heading4FontWeight: h4.fontWeight || defaultExportTokens.heading4FontWeight,
    heading5FontWeight: h5.fontWeight || defaultExportTokens.heading5FontWeight,
    heading6FontWeight: h6.fontWeight || defaultExportTokens.heading6FontWeight,
    heading1FontStyle: h1.fontStyle || defaultExportTokens.heading1FontStyle,
    heading2FontStyle: h2.fontStyle || defaultExportTokens.heading2FontStyle,
    heading3FontStyle: h3.fontStyle || defaultExportTokens.heading3FontStyle,
    heading4FontStyle: h4.fontStyle || defaultExportTokens.heading4FontStyle,
    heading5FontStyle: h5.fontStyle || defaultExportTokens.heading5FontStyle,
    heading6FontStyle: h6.fontStyle || defaultExportTokens.heading6FontStyle,
    heading1LetterSpacing: h1.letterSpacing || defaultExportTokens.heading1LetterSpacing,
    heading2LetterSpacing: h2.letterSpacing || defaultExportTokens.heading2LetterSpacing,
    heading3LetterSpacing: h3.letterSpacing || defaultExportTokens.heading3LetterSpacing,
    heading4LetterSpacing: h4.letterSpacing || defaultExportTokens.heading4LetterSpacing,
    heading5LetterSpacing: h5.letterSpacing || defaultExportTokens.heading5LetterSpacing,
    heading6LetterSpacing: h6.letterSpacing || defaultExportTokens.heading6LetterSpacing,
    heading1TextShadow: h1.textShadow || defaultExportTokens.heading1TextShadow,
    heading2TextShadow: h2.textShadow || defaultExportTokens.heading2TextShadow,
    heading3TextShadow: h3.textShadow || defaultExportTokens.heading3TextShadow,
    heading4TextShadow: h4.textShadow || defaultExportTokens.heading4TextShadow,
    heading5TextShadow: h5.textShadow || defaultExportTokens.heading5TextShadow,
    heading6TextShadow: h6.textShadow || defaultExportTokens.heading6TextShadow,
  }

  const tokens: ExportStyleTokens = {
    bodyBackground: exportStyleMappingConfig.bodyBackground ? resolvedTokens.bodyBackground : defaultExportTokens.bodyBackground,
    bodyTextColor: exportStyleMappingConfig.bodyTextColor ? resolvedTokens.bodyTextColor : defaultExportTokens.bodyTextColor,
    bodyLinkColor: exportStyleMappingConfig.bodyLinkColor ? resolvedTokens.bodyLinkColor : defaultExportTokens.bodyLinkColor,
    bodyBorderColor: exportStyleMappingConfig.bodyBorderColor ? resolvedTokens.bodyBorderColor : defaultExportTokens.bodyBorderColor,
    bodyBlockquoteBorderColor: exportStyleMappingConfig.bodyBlockquoteBorderColor ? resolvedTokens.bodyBlockquoteBorderColor : defaultExportTokens.bodyBlockquoteBorderColor,
    bodyBlockquoteColor: exportStyleMappingConfig.bodyBlockquoteColor ? resolvedTokens.bodyBlockquoteColor : defaultExportTokens.bodyBlockquoteColor,
    codeBackground: exportStyleMappingConfig.codeBackground ? resolvedTokens.codeBackground : defaultExportTokens.codeBackground,
    codeBorderColor: exportStyleMappingConfig.codeBorderColor ? resolvedTokens.codeBorderColor : defaultExportTokens.codeBorderColor,
    codeRadius: exportStyleMappingConfig.codeRadius ? resolvedTokens.codeRadius : defaultExportTokens.codeRadius,
    textBorderColor: exportStyleMappingConfig.textBorderColor ? resolvedTokens.textBorderColor : defaultExportTokens.textBorderColor,
    textRadius: exportStyleMappingConfig.textRadius ? resolvedTokens.textRadius : defaultExportTokens.textRadius,
    previewFontFamily: exportStyleMappingConfig.previewFontFamily ? resolvedTokens.previewFontFamily : defaultExportTokens.previewFontFamily,
    previewFontSize: exportStyleMappingConfig.previewFontSize ? resolvedTokens.previewFontSize : defaultExportTokens.previewFontSize,
    previewFontWeight: exportStyleMappingConfig.previewFontWeight ? resolvedTokens.previewFontWeight : defaultExportTokens.previewFontWeight,
    previewLineHeight: exportStyleMappingConfig.previewLineHeight ? resolvedTokens.previewLineHeight : defaultExportTokens.previewLineHeight,
    previewLetterSpacing: exportStyleMappingConfig.previewLetterSpacing ? resolvedTokens.previewLetterSpacing : defaultExportTokens.previewLetterSpacing,
    previewFontSynthesis: exportStyleMappingConfig.previewFontSynthesis ? resolvedTokens.previewFontSynthesis : defaultExportTokens.previewFontSynthesis,
    previewTextShadow: exportStyleMappingConfig.previewTextShadow ? resolvedTokens.previewTextShadow : defaultExportTokens.previewTextShadow,
    previewPadding: exportStyleMappingConfig.previewPadding ? resolvedTokens.previewPadding : defaultExportTokens.previewPadding,
    previewCodeFont: exportStyleMappingConfig.previewCodeFont ? resolvedTokens.previewCodeFont : defaultExportTokens.previewCodeFont,
    previewInlineCodeSize: exportStyleMappingConfig.previewInlineCodeSize ? resolvedTokens.previewInlineCodeSize : defaultExportTokens.previewInlineCodeSize,
    previewInlineCodePadding: exportStyleMappingConfig.previewInlineCodePadding ? resolvedTokens.previewInlineCodePadding : defaultExportTokens.previewInlineCodePadding,
    previewHighlightedBackground: exportStyleMappingConfig.previewHighlightedBackground ? resolvedTokens.previewHighlightedBackground : defaultExportTokens.previewHighlightedBackground,
    headingTextShadow: exportStyleMappingConfig.headingTextShadow ? resolvedTokens.headingTextShadow : defaultExportTokens.headingTextShadow,
    heading1FontSize: exportStyleMappingConfig.heading1FontSize ? resolvedTokens.heading1FontSize : defaultExportTokens.heading1FontSize,
    heading2FontSize: exportStyleMappingConfig.heading2FontSize ? resolvedTokens.heading2FontSize : defaultExportTokens.heading2FontSize,
    heading3FontSize: exportStyleMappingConfig.heading3FontSize ? resolvedTokens.heading3FontSize : defaultExportTokens.heading3FontSize,
    heading4FontSize: exportStyleMappingConfig.heading4FontSize ? resolvedTokens.heading4FontSize : defaultExportTokens.heading4FontSize,
    heading5FontSize: exportStyleMappingConfig.heading5FontSize ? resolvedTokens.heading5FontSize : defaultExportTokens.heading5FontSize,
    heading6FontSize: exportStyleMappingConfig.heading6FontSize ? resolvedTokens.heading6FontSize : defaultExportTokens.heading6FontSize,
    heading1FontWeight: exportStyleMappingConfig.heading1FontWeight ? resolvedTokens.heading1FontWeight : defaultExportTokens.heading1FontWeight,
    heading2FontWeight: exportStyleMappingConfig.heading2FontWeight ? resolvedTokens.heading2FontWeight : defaultExportTokens.heading2FontWeight,
    heading3FontWeight: exportStyleMappingConfig.heading3FontWeight ? resolvedTokens.heading3FontWeight : defaultExportTokens.heading3FontWeight,
    heading4FontWeight: exportStyleMappingConfig.heading4FontWeight ? resolvedTokens.heading4FontWeight : defaultExportTokens.heading4FontWeight,
    heading5FontWeight: exportStyleMappingConfig.heading5FontWeight ? resolvedTokens.heading5FontWeight : defaultExportTokens.heading5FontWeight,
    heading6FontWeight: exportStyleMappingConfig.heading6FontWeight ? resolvedTokens.heading6FontWeight : defaultExportTokens.heading6FontWeight,
    heading1FontStyle: exportStyleMappingConfig.heading1FontStyle ? resolvedTokens.heading1FontStyle : defaultExportTokens.heading1FontStyle,
    heading2FontStyle: exportStyleMappingConfig.heading2FontStyle ? resolvedTokens.heading2FontStyle : defaultExportTokens.heading2FontStyle,
    heading3FontStyle: exportStyleMappingConfig.heading3FontStyle ? resolvedTokens.heading3FontStyle : defaultExportTokens.heading3FontStyle,
    heading4FontStyle: exportStyleMappingConfig.heading4FontStyle ? resolvedTokens.heading4FontStyle : defaultExportTokens.heading4FontStyle,
    heading5FontStyle: exportStyleMappingConfig.heading5FontStyle ? resolvedTokens.heading5FontStyle : defaultExportTokens.heading5FontStyle,
    heading6FontStyle: exportStyleMappingConfig.heading6FontStyle ? resolvedTokens.heading6FontStyle : defaultExportTokens.heading6FontStyle,
    heading1LetterSpacing: exportStyleMappingConfig.heading1LetterSpacing ? resolvedTokens.heading1LetterSpacing : defaultExportTokens.heading1LetterSpacing,
    heading2LetterSpacing: exportStyleMappingConfig.heading2LetterSpacing ? resolvedTokens.heading2LetterSpacing : defaultExportTokens.heading2LetterSpacing,
    heading3LetterSpacing: exportStyleMappingConfig.heading3LetterSpacing ? resolvedTokens.heading3LetterSpacing : defaultExportTokens.heading3LetterSpacing,
    heading4LetterSpacing: exportStyleMappingConfig.heading4LetterSpacing ? resolvedTokens.heading4LetterSpacing : defaultExportTokens.heading4LetterSpacing,
    heading5LetterSpacing: exportStyleMappingConfig.heading5LetterSpacing ? resolvedTokens.heading5LetterSpacing : defaultExportTokens.heading5LetterSpacing,
    heading6LetterSpacing: exportStyleMappingConfig.heading6LetterSpacing ? resolvedTokens.heading6LetterSpacing : defaultExportTokens.heading6LetterSpacing,
    heading1TextShadow: exportStyleMappingConfig.heading1TextShadow ? resolvedTokens.heading1TextShadow : defaultExportTokens.heading1TextShadow,
    heading2TextShadow: exportStyleMappingConfig.heading2TextShadow ? resolvedTokens.heading2TextShadow : defaultExportTokens.heading2TextShadow,
    heading3TextShadow: exportStyleMappingConfig.heading3TextShadow ? resolvedTokens.heading3TextShadow : defaultExportTokens.heading3TextShadow,
    heading4TextShadow: exportStyleMappingConfig.heading4TextShadow ? resolvedTokens.heading4TextShadow : defaultExportTokens.heading4TextShadow,
    heading5TextShadow: exportStyleMappingConfig.heading5TextShadow ? resolvedTokens.heading5TextShadow : defaultExportTokens.heading5TextShadow,
    heading6TextShadow: exportStyleMappingConfig.heading6TextShadow ? resolvedTokens.heading6TextShadow : defaultExportTokens.heading6TextShadow,
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

  return `${buildExportFontFaceCss()}

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
  font-weight: ${tokens.previewFontWeight};
  line-height: ${tokens.previewLineHeight};
  letter-spacing: ${tokens.previewLetterSpacing};
  font-synthesis: ${tokens.previewFontSynthesis};
}

@page {
  size: A4;
  margin: calc(3 * ${tokens.previewPadding});
}

body {
  margin: 0;
  -webkit-print-color-adjust: exact;
}

.pdf-exporter-page {
  width: 100%;
  max-width: 100%;
  min-height: auto;
  padding: 0;
  box-sizing: border-box;
  background: ${tokens.bodyBackground};
  color: ${tokens.bodyTextColor};
  margin: 0;
  overflow: visible;
}

.markdown-preview {
  width: 100%;
  height: auto;
  overflow: visible;
  padding: 0;
  box-sizing: border-box;
  color: ${tokens.bodyTextColor};
  text-shadow: ${tokens.previewTextShadow};
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
  text-shadow: ${tokens.headingTextShadow};
  page-break-after: avoid;
  break-after: avoid;
}

.markdown-preview h1 { font-size: ${tokens.heading1FontSize}; font-weight: ${tokens.heading1FontWeight}; font-style: ${tokens.heading1FontStyle}; letter-spacing: ${tokens.heading1LetterSpacing}; text-shadow: ${tokens.heading1TextShadow}; }
.markdown-preview h2 { font-size: ${tokens.heading2FontSize}; font-weight: ${tokens.heading2FontWeight}; font-style: ${tokens.heading2FontStyle}; letter-spacing: ${tokens.heading2LetterSpacing}; text-shadow: ${tokens.heading2TextShadow}; }
.markdown-preview h3 { font-size: ${tokens.heading3FontSize}; font-weight: ${tokens.heading3FontWeight}; font-style: ${tokens.heading3FontStyle}; letter-spacing: ${tokens.heading3LetterSpacing}; text-shadow: ${tokens.heading3TextShadow}; }
.markdown-preview h4 { font-size: ${tokens.heading4FontSize}; font-weight: ${tokens.heading4FontWeight}; font-style: ${tokens.heading4FontStyle}; letter-spacing: ${tokens.heading4LetterSpacing}; text-shadow: ${tokens.heading4TextShadow}; }
.markdown-preview h5 { font-size: ${tokens.heading5FontSize}; font-weight: ${tokens.heading5FontWeight}; font-style: ${tokens.heading5FontStyle}; letter-spacing: ${tokens.heading5LetterSpacing}; text-shadow: ${tokens.heading5TextShadow}; }
.markdown-preview h6 { font-size: ${tokens.heading6FontSize}; font-weight: ${tokens.heading6FontWeight}; font-style: ${tokens.heading6FontStyle}; letter-spacing: ${tokens.heading6LetterSpacing}; text-shadow: ${tokens.heading6TextShadow}; }

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
