// The serializability constraint, as a type.
//
// The whole game is resumable at ANY point -- mid-combat, mid-offer,
// halfway through a nested menu -- which is only true if every piece of
// state the director holds can be written to disk and read back as itself.
// One closure, one class instance, one Map, and that promise is broken for
// whoever happens to quit at that moment. Nothing catches it at runtime
// (JSON.stringify silently drops a function), so it is caught here, at
// compile time, by making stage state a type that cannot express anything
// else.
//
// This is the single rule that makes "leave the game" a core cell on every
// screen rather than a feature with an asterisk.

export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject

export interface JsonObject {
  readonly [key: string]: JsonValue | undefined
}
