// The structural sanitizer for a persisted save.
//
// Runs in the MAIN process, over whatever was on disk. Its only job is that
// every field is the shape it claims to be: it knows nothing about content,
// because deciding whether item "spyglass" still exists is content's
// business and content lives in the renderer. An id content no longer has
// is dropped where it is read (model/gameState.ts), not here.
//
// Null means "there is no save", which every caller already handles -- so a
// corrupt file degrades to a fresh welcome screen rather than to a crash on
// launch. That is the same discipline the rest of the persisted menu state
// uses, and it exists because this file is read before anything can be
// rendered to complain with.

import { DEFAULT_SETTINGS, SAVE_VERSION, type DirectorState, type GameRecord, type GameSave, type StageFrame } from './model/gameState'
import { DEFAULT_DIFFICULTY, isDifficulty } from './model/difficulty'
import { STAT_KEYS, type StatBlock } from './model/stats'
import { FIRST_MILESTONE_THRESHOLD } from './model/milestones'
import type { JsonObject } from './core/json'
import type { ModifierKind } from './model/modifiers'
import { toRngState } from './core/rng'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** A 0..1 knob. Anything else is 0, which is the value that changes nothing. */
function fraction(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0
}

function wholeAtLeast(value: unknown, minimum: number): number {
  return Math.max(minimum, Math.floor(finite(value, minimum)))
}

/**
 * Stage state is opaque to everything but the stage that wrote it, so it is
 * sanitized STRUCTURALLY: whatever survives a JSON round trip is kept as
 * is. A stage that finds a field missing is a stage reading its own old
 * save, which is its business to tolerate -- not something this file can
 * decide on its behalf.
 */
function sanitizeJsonObject(value: unknown): JsonObject | null {
  if (!isRecord(value)) return null
  try {
    const round = JSON.parse(JSON.stringify(value)) as unknown
    return isRecord(round) ? (round as JsonObject) : null
  } catch {
    return null
  }
}

function sanitizeStats(value: unknown): StatBlock {
  const source = isRecord(value) ? value : {}
  return Object.fromEntries(STAT_KEYS.map((key) => [key, wholeAtLeast(source[key], 0)])) as StatBlock
}

function sanitizeFrames(value: unknown): StageFrame[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.stageId !== 'string' || entry.stageId.length === 0) return []
    const state = sanitizeJsonObject(entry.state)
    return state ? [{ stageId: entry.stageId, state }] : []
  })
}

function sanitizeNarration(value: unknown): string[] {
  if (typeof value === 'string') return value.length > 0 ? [value] : []
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}

function sanitizeDirector(value: unknown): DirectorState {
  const source = isRecord(value) ? value : {}
  return {
    stack: sanitizeFrames(source.stack),
    // Was ONE string before narration became a list, and a save written by
    // that version is read rather than discarded: a line is a list of one,
    // which is exactly what it meant. Nothing else about the shape moved, so
    // this costs a widening here instead of a version bump that would throw
    // away somebody's run.
    narration: sanitizeNarration(source.narration),
    rng: toRngState(finite(source.rng, 1)),
  }
}

function sanitizeGame(value: unknown): GameRecord | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== 'string' || value.id.length === 0) return null
  const status = value.status === 'over' ? 'over' : 'active'
  const armor = isRecord(value.armor) ? value.armor : {}
  const createdAtMs = finite(value.createdAtMs, 0)

  return {
    id: value.id,
    seed: toRngState(finite(value.seed, 1)),
    createdAtMs,
    updatedAtMs: finite(value.updatedAtMs, createdAtMs),
    status,
    ...(value.endedReason === 'defeat' || value.endedReason === 'retired'
      ? { endedReason: value.endedReason }
      : {}),
    level: wholeAtLeast(value.level, 1),
    // A run saved before presets existed is played out at the default rather
    // than discarded -- the same widening the narration list took.
    difficulty: isDifficulty(value.difficulty) ? value.difficulty : DEFAULT_DIFFICULTY,
    successAdjust: fraction(value.successAdjust),
    keepItemId: typeof value.keepItemId === 'string' ? value.keepItemId : null,
    keepTraitId: typeof value.keepTraitId === 'string' ? value.keepTraitId : null,
    regionId: typeof value.regionId === 'string' ? value.regionId : null,
    baseStats: sanitizeStats(value.baseStats),
    statPointsSpent: wholeAtLeast(value.statPointsSpent, 0),
    experienceEarned: wholeAtLeast(value.experienceEarned, 0),
    experienceSpentOnTraits: wholeAtLeast(value.experienceSpentOnTraits, 0),
    // Floored at the FIRST threshold rather than at 0: a zero here would
    // mean every stat point is already earned, forever.
    experienceToNextStatPoint: wholeAtLeast(value.experienceToNextStatPoint, FIRST_MILESTONE_THRESHOLD),
    goldEarned: wholeAtLeast(value.goldEarned, 0),
    goldSpentOnItems: wholeAtLeast(value.goldSpentOnItems, 0),
    // Floored at the FIRST threshold for the same reason the experience one
    // is: a zero here would mean every fame point is already earned, forever.
    goldToNextFamePoint: wholeAtLeast(value.goldToNextFamePoint, FIRST_MILESTONE_THRESHOLD),
    famePoints: wholeAtLeast(value.famePoints, 0),
    famePointsSpent: wholeAtLeast(value.famePointsSpent, 0),
    hitPoints: wholeAtLeast(value.hitPoints, 0),
    armor: { fromItems: wholeAtLeast(armor.fromItems, 0), natural: wholeAtLeast(armor.natural, 0) },
  }
}

export function sanitizeGameSave(input: unknown): GameSave | null {
  if (!isRecord(input)) return null
  if (input.version !== SAVE_VERSION) return null

  const games = Array.isArray(input.games) ? input.games.flatMap((game) => sanitizeGame(game) ?? []) : []
  const ids = new Set(games.map((game) => game.id))
  const profile = isRecord(input.profile) ? input.profile : {}
  const settings = isRecord(input.settings) ? input.settings : {}

  const holdings = (Array.isArray(input.holdings) ? input.holdings : []).flatMap((row) => {
    if (!isRecord(row)) return []
    if (typeof row.gameId !== 'string' || !ids.has(row.gameId)) return []
    if (typeof row.modifierId !== 'string' || row.modifierId.length === 0) return []
    if (row.kind !== 'item' && row.kind !== 'trait') return []
    const kind: ModifierKind = row.kind
    return [{ gameId: row.gameId, kind, modifierId: row.modifierId, seq: wholeAtLeast(row.seq, 0) }]
  })

  const outcomes = (Array.isArray(input.outcomes) ? input.outcomes : []).flatMap((row) => {
    if (!isRecord(row)) return []
    if (typeof row.gameId !== 'string' || !ids.has(row.gameId)) return []
    if (typeof row.outcome !== 'string' || row.outcome.length === 0) return []
    return [
      {
        gameId: row.gameId,
        seq: wholeAtLeast(row.seq, 0),
        outcome: row.outcome,
        payload: sanitizeJsonObject(row.payload) ?? {},
      },
    ]
  })

  const activeGameId = typeof input.activeGameId === 'string' && ids.has(input.activeGameId) ? input.activeGameId : null

  return {
    version: SAVE_VERSION,
    profile: {
      gamesStarted: wholeAtLeast(profile.gamesStarted, 0),
      gamesEnded: wholeAtLeast(profile.gamesEnded, 0),
      bestFame: wholeAtLeast(profile.bestFame, 0),
    },
    settings: {
      difficulty: isDifficulty(settings.difficulty) ? settings.difficulty : DEFAULT_SETTINGS.difficulty,
      successAdjust: fraction(settings.successAdjust),
    },
    games,
    holdings,
    outcomes,
    activeGameId,
    director: sanitizeDirector(input.director),
  }
}
