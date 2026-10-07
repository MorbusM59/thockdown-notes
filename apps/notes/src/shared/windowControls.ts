import type { EventChannels, InvokeChannels, SendChannels } from './ipcContract';

/**
 * The frameless window's own controls, exposed as `window.windowControls`.
 * Every IPC-backed method is declared once here and wired through
 * `ipcContract`; `getPageZoomFactor` is answered in the preload itself.
 */
export interface WindowControlsApi {
  minimize(): void;
  toggleMaximize(): void;
  close(): void;
  toggleDevTools(): void;
  /** Enters or leaves mini mode; resolves to whether the window changed. */
  toggleUtilityCollapse(size: { width: number; height: number }): Promise<boolean>;
  reportBackgroundColor(hex: string): void;
  setSidebarVisible(visible: boolean): void;
  setSectionCount(count: number): void;
  setChromeMinSize(size: { width: number; widthWithoutSidebar: number; height: number }): void;
  setDoubleSizeMode(enabled: boolean): void;
  setFullScreen(enabled: boolean): void;
  /** The page's own zoom factor (double size mode's 2x), independent of the display's scaling. */
  getPageZoomFactor(): number;
  // Custom window dragging: see shared/windowDrag.ts and the handlers in main.ts.
  startWindowDrag(screenX: number, screenY: number): void;
  moveWindowDrag(screenX: number, screenY: number): void;
  endWindowDrag(): void;
  restoreMaximizedWindow(originX: number, originY: number, releaseX: number, releaseY: number): void;
  onMaximizeStateChange(callback: (isMaximized: boolean) => void): () => void;
  onCollapsedStateChange(callback: (isCollapsed: boolean) => void): () => void;
  onFullScreenStateChange(callback: (isFullScreen: boolean) => void): () => void;
}

export const WINDOW_CONTROL_SEND_CHANNELS = {
  minimize: 'window-control:minimize',
  toggleMaximize: 'window-control:toggle-maximize',
  close: 'window-control:close',
  toggleDevTools: 'window-control:toggle-devtools',
  reportBackgroundColor: 'window-control:report-background-color',
  setSidebarVisible: 'window-control:sidebar-visibility',
  setSectionCount: 'window-control:section-count',
  setChromeMinSize: 'window-control:chrome-min-size',
  setDoubleSizeMode: 'window-control:double-size-mode',
  setFullScreen: 'window-control:full-screen',
  startWindowDrag: 'window-drag:start',
  moveWindowDrag: 'window-drag:move',
  endWindowDrag: 'window-drag:end',
  restoreMaximizedWindow: 'window-drag:restore-maximized',
} as const satisfies SendChannels<WindowControlsApi>;

export const WINDOW_CONTROL_INVOKE_CHANNELS = {
  toggleUtilityCollapse: 'window-control:toggle-utility-collapse',
} as const satisfies InvokeChannels<WindowControlsApi>;

/** What the main process tells the window about its own state, unprompted. */
export interface WindowEvents {
  maximizeState: boolean;
  collapsedState: boolean;
  fullScreenState: boolean;
}

export const WINDOW_EVENT_CHANNELS = {
  maximizeState: 'window-maximize-state',
  collapsedState: 'window-collapsed-state',
  fullScreenState: 'window-fullscreen-state',
} as const satisfies EventChannels<WindowEvents>;
