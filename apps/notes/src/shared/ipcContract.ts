// One declaration for every request the renderer makes of the main process.
//
// Each area's API interface (`NoteTabsApi`, `ChaptersApi`, ...) is the
// contract. Its channel map is keyed by the interface's method names and
// checked with `satisfies InvokeChannels<Api>`, so a method with no channel,
// or a channel for a method that does not exist, fails to compile. The
// preload builds the bridge from the map (`invokeBridge`) and the main
// process registers its handlers from the same map (`registerInvokeHandlers`),
// each handler typed by the method it answers: its arguments and its result
// are the interface's, so the two sides cannot disagree about either without
// a type error. Before this, the channel string, the preload wrapper, the
// main handler and the interface were four declarations of one call, checked
// separately, and the main side's return types were never checked at all.
//
// Only request/reply calls (`ipcRenderer.invoke` / `ipcMain.handle`) go
// through here. A method that does not return a promise -- a synchronous
// read such as `getPathForFile`, or an `on...` subscription to an event the
// main process sends -- is not a request, is excluded from the map by type,
// and stays written out by hand in the preload.
//
// This module imports nothing from Electron, so the renderer, the preload
// and the main process can all use it; the two Electron entry points pass
// in `ipcRenderer.invoke` and `ipcMain.handle`.

/** The method names of `Api` that are request/reply calls (they return a promise). */
export type InvokeMethodName<Api> = {
  [K in keyof Api]: Api[K] extends (...args: never[]) => Promise<unknown> ? K : never
}[keyof Api]

/** The channel map for `Api`: exactly one channel string per request/reply method. */
export type InvokeChannels<Api> = { readonly [K in InvokeMethodName<Api>]: string }

/**
 * The main-process handlers for `Api`. Each receives the IPC event first
 * (`Event` is Electron's `IpcMainInvokeEvent` in practice; most handlers
 * ignore it, and the ones that open a dialog read its sender window), then
 * exactly the method's arguments, and returns the method's result or a
 * promise of it.
 */
export type InvokeHandlers<Api, Event> = {
  [K in InvokeMethodName<Api>]: Api[K] extends (...args: infer Args) => Promise<infer Result>
    ? (event: Event, ...args: Args) => Result | Promise<Result>
    : never
}

/** Builds the renderer-side request methods of `Api` from its channel map. */
export function invokeBridge<Api>(
  channels: InvokeChannels<Api>,
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>,
): Pick<Api, InvokeMethodName<Api>> {
  const bridge: Record<string, (...args: unknown[]) => Promise<unknown>> = {}
  for (const [method, channel] of Object.entries(channels) as Array<[string, string]>) {
    bridge[method] = (...args) => invoke(channel, ...args)
  }
  return bridge as unknown as Pick<Api, InvokeMethodName<Api>>
}

/** Registers one main-process handler per channel in `Api`'s channel map. */
export function registerInvokeHandlers<Api, Event>(
  channels: InvokeChannels<Api>,
  handlers: InvokeHandlers<Api, Event>,
  handle: (channel: string, listener: (event: Event, ...args: unknown[]) => unknown) => void,
): void {
  const byMethod = handlers as unknown as Record<string, (event: Event, ...args: unknown[]) => unknown>
  for (const [method, channel] of Object.entries(channels) as Array<[string, string]>) {
    handle(channel, (event, ...args) => byMethod[method](event, ...args))
  }
}
