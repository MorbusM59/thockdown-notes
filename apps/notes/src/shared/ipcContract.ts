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
// Three kinds of traffic cross the boundary and each has its section below:
// requests that wait for a reply, fire-and-forget messages, and events the
// main process sends unprompted. A method that is none of these -- a
// synchronous read in the preload such as `getPathForFile` -- is excluded
// from every map by type and stays written out by hand.
//
// This module imports nothing from Electron, so the renderer, the preload
// and the main process can all use it; the two Electron entry points pass
// in `ipcRenderer` / `ipcMain` / `webContents` methods.

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

// ---- Fire-and-forget messages (`ipcRenderer.send` / `ipcMain.on`) ----
//
// The same arrangement for calls that expect no reply: a method returning
// `void` on the API interface, one channel per method, the bridge and the
// handlers both built from the map.

/** The method names of `Api` that are fire-and-forget messages (they return `void`). */
export type SendMethodName<Api> = {
  [K in keyof Api]: Api[K] extends (...args: never[]) => infer Result
    ? [Result] extends [void] ? K : never
    : never
}[keyof Api]

/** The channel map for `Api`'s fire-and-forget messages: exactly one channel per such method. */
export type SendChannels<Api> = { readonly [K in SendMethodName<Api>]: string }

/** The main-process handlers for `Api`'s fire-and-forget messages: the IPC event, then the method's arguments. */
export type SendHandlers<Api, Event> = {
  [K in SendMethodName<Api>]: Api[K] extends (...args: infer Args) => void
    ? (event: Event, ...args: Args) => void
    : never
}

/** Builds the renderer-side fire-and-forget methods of `Api` from its channel map. */
export function sendBridge<Api>(
  channels: SendChannels<Api>,
  send: (channel: string, ...args: unknown[]) => void,
): Pick<Api, SendMethodName<Api>> {
  const bridge: Record<string, (...args: unknown[]) => void> = {}
  for (const [method, channel] of Object.entries(channels) as Array<[string, string]>) {
    bridge[method] = (...args) => send(channel, ...args)
  }
  return bridge as unknown as Pick<Api, SendMethodName<Api>>
}

/** Registers one main-process listener per channel in `Api`'s fire-and-forget map. */
export function registerSendHandlers<Api, Event>(
  channels: SendChannels<Api>,
  handlers: SendHandlers<Api, Event>,
  on: (channel: string, listener: (event: Event, ...args: unknown[]) => void) => void,
): void {
  const byMethod = handlers as unknown as Record<string, (event: Event, ...args: unknown[]) => void>
  for (const [method, channel] of Object.entries(channels) as Array<[string, string]>) {
    on(channel, (event, ...args) => byMethod[method](event, ...args))
  }
}

// ---- Events the main process sends unprompted (`webContents.send` / `ipcRenderer.on`) ----
//
// An event map names each event and its one payload (`{ maximizeState:
// boolean }`); its channel map gives each a channel. The main process emits
// through an `eventEmitter` and the preload subscribes through an
// `eventSubscriber`, so the payload's type is the map's on both sides.

/** The channel map for an event map: one channel per event. */
export type EventChannels<Events> = { readonly [K in keyof Events]: string }

/**
 * The main process's sender for an event map: `emit(target, name, payload)`
 * with the payload typed by the map. The map is named once, here, so a call
 * site cannot widen it by inference from the payload it happens to pass.
 */
export function eventEmitter<Events>(channels: EventChannels<Events>) {
  return <K extends keyof Events>(
    target: { send(channel: string, ...args: unknown[]): void },
    name: K,
    payload: Events[K],
  ): void => {
    target.send(channels[name], payload)
  }
}

/** The preload's subscriber for an event map: `subscribe(name, callback)` returns the unsubscribe. */
export function eventSubscriber<Events, Event>(
  channels: EventChannels<Events>,
  on: (channel: string, listener: (event: Event, ...args: unknown[]) => void) => void,
  off: (channel: string, listener: (event: Event, ...args: unknown[]) => void) => void,
) {
  return <K extends keyof Events>(name: K, callback: (payload: Events[K]) => void): (() => void) => {
    // The payload's type is the map's because `eventEmitter` sent it typed by the same map.
    const listener = (_event: Event, ...args: unknown[]) => callback(args[0] as Events[K])
    on(channels[name], listener)
    return () => off(channels[name], listener)
  }
}
