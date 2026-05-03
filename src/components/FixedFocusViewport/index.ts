export { FixedFocusEditor } from './FixedFocusEditor';
export { ceGetSelection, ceSetSelection, ceGetText } from './FixedFocusEditor';
export { FixedFocusViewportModel } from './viewportModel';
export {
  PRESET_METRICS,
  computeMetrics,
  getFontSizePx,
  rowsInHeight,
  heightForRows,
  type ComputedMetrics,
} from './lineMetrics';
export {
  computeWrappedLines,
  findRowForCharIndex,
  getRowCharRange,
  getTotalWrappedRows,
  type WrappedLine,
} from './textWrapping';
