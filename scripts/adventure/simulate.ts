// How the game actually plays, in numbers: thousands of runs, in a second.
//
// WHY THIS IS NOT PLAYWRIGHT. The game is a pure function of a seed and a
// list of choices (core/director.ts) -- the app around it draws the result
// and contributes nothing to it. A statistical question ("how often does a
// level-one warrior survive their first fight") is therefore answered by the
// model, and a browser in the loop would add a few hundred milliseconds per
// CHOICE to a question that needs a hundred thousand of them. The Playwright
// harness beside this one answers the other question -- whether what the
// model computed reaches the screen intact -- and neither can answer the
// other's.
//
//   npx vite-node scripts/adventure/simulate.ts -- --runs=400 --difficulty=all
//   npx vite-node scripts/adventure/simulate.ts -- --rank --difficulty=medium
//   npx vite-node scripts/adventure/simulate.ts -- --sweep-adjust
//
// Flags: --runs, --difficulty (a preset, or `all`), --seed, --policy
//        (`careful` | `reckless` | `first`), --levels (stop after N),
//        --prefer=id,id (take these offers when they appear), --pin=id,id
//        (hand them over outright), --rank (one pass per item and trait, each
//        pinned in turn, to see what each is actually worth),
//        --success-adjust=0.3 (the thumb on the scale -- see
//        model/chance.ts), --sweep-adjust[=0,0.1,0.2] (one pass per thumb
//        setting), --json.
//
// A run is autoplayed by a POLICY -- a small, stated way of choosing -- and
// the numbers mean nothing without knowing which one produced them, so every
// report names it. `careful` is the closest to how a person plays; `first`
// is the walk the tests use, kept because it is the worst case and the one
// that finds stalls.

import { buildCatalog, THOCKQUEST } from '../../src/adventure/content'
import { choose, currentScreen, enterEntryScreen, type DirectorDeps } from '../../src/adventure/core/director'
import type { Screen } from '../../src/adventure/core/screen'
import { activeGame, applyEffects, emptySave, type GameSave } from '../../src/adventure/model/gameState'
import { isOfferable, type Modifier } from '../../src/adventure/model/modifiers'
import { DIFFICULTIES, DIFFICULTY_LABELS, type Difficulty } from '../../src/adventure/model/difficulty'
import { ROOT_STAGE_ID, STAGES } from '../../src/adventure/stages'

const DEPS: DirectorDeps = {
  stages: STAGES,
  content: THOCKQUEST,
  catalog: buildCatalog(THOCKQUEST),
  rootStageId: ROOT_STAGE_ID,
}

const NOW = 1_700_000_000_000
/** A run that has not died or reached the level cap by here is not going to. */
const MAX_CHOICES = 20_000

type PolicyName = 'careful' | 'reckless' | 'first'

interface Situation {
  screen: Screen
  save: GameSave
  /** 0..1, or null before there is a run. */
  health: number | null
  /** Modifier ids this run is trying to acquire, in order of preference. */
  prefer: readonly string[]
}

type Policy = (situation: Situation) => string

/**
 * Takes a preferred modifier whenever one is on the screen. Offers name the
 * modifier in their choice id (`offer:spyglass`, `loot:item:whetstone`), so
 * this needs no knowledge of which stage it is standing in.
 */
function preferred(screen: Screen, prefer: readonly string[]): string | null {
  for (const id of prefer) {
    const choice = screen.choices.find((candidate) => candidate.id.endsWith(`:${id}`))
    if (choice) return choice.id
  }
  return null
}

const pick = (screen: Screen, ...ids: string[]): string | null =>
  ids.find((id) => screen.choices.some((choice) => choice.id === id)) ?? null

const firstReal = (screen: Screen): string =>
  (screen.choices.find((choice) => choice.id !== 'welcome:leave') ?? screen.choices[0]).id

/**
 * Plays a fight the way a person would: never take a blow you can avoid, and
 * run when the next one would kill you.
 */
const careful: Policy = ({ screen, health, prefer }) => {
  const wanted = preferred(screen, prefer)
  if (wanted) return wanted
  // A point in hand is worth nothing, and the hub offers it on every screen.
  const spend = pick(screen, 'encounter:spendStatPoint')
  if (spend) return spend
  if (health !== null && health < 0.25) {
    const flee = pick(screen, 'defence:flee')
    if (flee) return flee
  }
  return pick(screen, 'defence:dodge', 'defence:defend', 'combat:attack') ?? firstReal(screen)
}

/** Never gives ground: no dodging, no fleeing, and takes every hit. */
const reckless: Policy = ({ screen, prefer }) =>
  pick(screen, 'combat:attack', 'defence:takeTheHit', 'defence:defend')
  ?? preferred(screen, prefer)
  ?? firstReal(screen)

const POLICIES: Readonly<Record<PolicyName, Policy>> = { careful, reckless, first: ({ screen }) => firstReal(screen) }

interface RunResult {
  died: boolean
  /** Levels fully cleared. */
  level: number
  encounters: number
  fights: number
  rounds: number
  choices: number
  damageTaken: number
  gold: number
  motes: number
  itemsHeld: number
  traitsHeld: number
}

/**
 * PINNING beats preferring, for measuring what one thing is worth.
 *
 * A preference only fires when the thing happens to be offered -- a trait is
 * drawn two-from-ten at character creation, so eight runs in ten came back
 * byte-identical to the baseline and the average moved by a fifth of whatever
 * the trait actually did. Pinning hands it to the character outright, the
 * moment there is a character to hand it to, and the column then means "what
 * is this worth" rather than "what is this worth, times how often you see
 * it".
 */
function playOne(
  seed: number,
  difficulty: Difficulty,
  policy: Policy,
  levelCap: number,
  prefer: readonly string[] = [],
  pin: readonly Modifier[] = [],
  successAdjust = 0,
): RunResult {
  let save: GameSave = { ...emptySave(seed), settings: { difficulty, successAdjust } }
  save = enterEntryScreen(save, DEPS, NOW)

  const result: RunResult = {
    died: false, level: 1, encounters: 0, fights: 0, rounds: 0, choices: 0,
    damageTaken: 0, gold: 0, motes: 0, itemsHeld: 0, traitsHeld: 0,
  }
  let lastStage = ''
  let pinned = false
  let lastHitPoints: number | null = null
  let lastNarration = 0

  for (let step = 0; step < MAX_CHOICES; step += 1) {
    const screen = currentScreen(save, DEPS)
    if (!screen) break
    let game = activeGame(save)
    if (pin.length > 0 && game && !pinned) {
      save = applyEffects(
        save,
        pin.map((modifier) => ({ kind: 'acquireModifier' as const, modifierKind: modifier.kind, modifierId: modifier.id })),
        DEPS.catalog,
        NOW,
      )
      game = activeGame(save)
      pinned = true
    }

    if (game) {
      if (lastHitPoints !== null && game.hitPoints < lastHitPoints) result.damageTaken += lastHitPoints - game.hitPoints
      lastHitPoints = game.hitPoints
      result.level = game.level
      if (game.status === 'over') {
        result.died = game.endedReason === 'defeat'
        break
      }
      if (game.level > levelCap) break
    }

    if (screen.stageId === 'combat' && lastStage !== 'combat') result.fights += 1
    if (screen.stageId === 'loot' && lastStage !== 'loot') result.encounters += 1
    // A round turns over exactly when the strip is cut back to one pill.
    if (screen.stageId === 'combat' && screen.narration.length === 1 && lastNarration > 1) result.rounds += 1
    lastNarration = screen.stageId === 'combat' ? screen.narration.length : 0
    lastStage = screen.stageId

    const health = game ? Math.min(1, game.hitPoints / Math.max(1, 50 + 15 * game.baseStats.might)) : null
    const choiceId = policy({ screen, save, health, prefer })
    const next = choose(save, choiceId, DEPS, NOW).save
    result.choices += 1
    // A choice the stage declined: the walk would spin here forever.
    if (next === save) break
    save = next
  }

  const game = activeGame(save)
  if (game) {
    result.gold = game.goldEarned
    result.motes = game.experienceEarned
    result.level = game.level
    if (game.status === 'over' && game.endedReason === 'defeat') result.died = true
  }
  result.itemsHeld = save.holdings.filter((row) => row.kind === 'item').length
  result.traitsHeld = save.holdings.filter((row) => row.kind === 'trait').length
  return result
}

function quantile(values: number[], fraction: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))]
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length
}

function summarize(runs: RunResult[]) {
  const encounters = runs.map((run) => run.encounters)
  return {
    runs: runs.length,
    deathRate: mean(runs.map((run) => (run.died ? 1 : 0))),
    encountersWon: { median: quantile(encounters, 0.5), p10: quantile(encounters, 0.1), p90: quantile(encounters, 0.9), mean: mean(encounters) },
    roundsPerFight: mean(runs.map((run) => (run.fights === 0 ? 0 : run.rounds / run.fights))),
    damagePerFight: mean(runs.map((run) => (run.fights === 0 ? 0 : run.damageTaken / run.fights))),
    levelReached: mean(runs.map((run) => run.level)),
    gold: mean(runs.map((run) => run.gold)),
    motes: mean(runs.map((run) => run.motes)),
  }
}

function parseArgs(argv: string[]) {
  const args = {
    runs: 200, difficulty: 'all', seed: 1, policy: 'careful' as PolicyName,
    levels: 3, json: false, prefer: [] as string[], pin: [] as string[], rank: false,
    successAdjust: 0, sweepAdjust: null as number[] | null,
  }
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, '').split('=')
    if (key === 'runs') args.runs = Number(value)
    else if (key === 'difficulty') args.difficulty = value
    else if (key === 'seed') args.seed = Number(value)
    else if (key === 'policy') args.policy = value as PolicyName
    else if (key === 'levels') args.levels = Number(value)
    else if (key === 'json') args.json = true
    else if (key === 'rank') args.rank = true
    else if (key === 'prefer') args.prefer = (value ?? '').split(',').filter(Boolean)
    else if (key === 'pin') args.pin = (value ?? '').split(',').filter(Boolean)
    else if (key === 'success-adjust') args.successAdjust = Number(value)
    else if (key === 'sweep-adjust') {
      args.sweepAdjust = value ? value.split(',').map(Number) : [0, 0.1, 0.2, 0.3, 0.4, 0.5]
    }
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
const policy = POLICIES[args.policy]
if (!policy) throw new Error(`unknown policy "${args.policy}" -- one of ${Object.keys(POLICIES).join(', ')}`)
const presets = args.difficulty === 'all'
  ? DIFFICULTIES
  : [args.difficulty as Difficulty].filter((value) => (DIFFICULTIES as readonly string[]).includes(value))
if (presets.length === 0) throw new Error(`unknown difficulty "${args.difficulty}"`)

function sweep(
  difficulty: Difficulty,
  prefer: readonly string[],
  pin: readonly Modifier[] = [],
  successAdjust = args.successAdjust,
) {
  const runs: RunResult[] = []
  for (let index = 0; index < args.runs; index += 1) {
    runs.push(playOne(args.seed + index * 7919, difficulty, policy, args.levels, prefer, pin, successAdjust))
  }
  return summarize(runs)
}

/**
 * WHAT EACH PIECE OF CONTENT IS WORTH, measured rather than argued: the same
 * runs, once per modifier, with that modifier taken whenever it is offered.
 *
 * The baseline row is the same sweep preferring nothing. A modifier that does
 * not move its row is either too weak to matter or is not reaching the fight
 * at all -- the second is the failure this found, when every chance-shaped
 * item measured as exactly nothing because combat resolved chances from the
 * stat block and never saw a modifier.
 */
if (args.rank) {
  const pool = [...THOCKQUEST.items, ...THOCKQUEST.traits].filter(isOfferable)
  const difficulty = (presets[0] ?? 'medium') as Difficulty
  const base = sweep(difficulty, [])
  console.log(`\n${args.runs} runs each, ${DIFFICULTY_LABELS[difficulty]}, policy "${args.policy}", preferring one thing at a time\n`)
  console.log('modifier                       encounters won (mean)   died   damage/fight')
  const rows = pool.map((modifier) => ({ modifier, row: sweep(difficulty, [], [modifier]) }))
  rows.sort((left, right) => right.row.encountersWon.mean - left.row.encountersWon.mean)
  const line = (name: string, row: ReturnType<typeof summarize>) => console.log(
    `${name.padEnd(30)} ${row.encountersWon.mean.toFixed(2).padStart(8)}`
    + `${`${(row.deathRate * 100).toFixed(0)}%`.padStart(14)}${row.damagePerFight.toFixed(1).padStart(15)}`,
  )
  line('(nothing pinned)', base)
  for (const { modifier, row } of rows) line(`${modifier.name} [${modifier.kind}]`, row)
  console.log('')
  process.exit(0)
}

const catalogue = [...THOCKQUEST.items, ...THOCKQUEST.traits]
const pinned = args.pin.map((id) => {
  const modifier = catalogue.find((candidate) => candidate.id === id)
  if (!modifier) throw new Error(`no item or trait with id "${id}"`)
  return modifier
})

/**
 * THE THUMB, one column per setting: what the same runs look like as a
 * player's failures and a monster's successes are scaled away.
 *
 * The point of the sweep rather than a single number is that the interesting
 * quantity is the SHAPE of the curve -- where survival stops being flat at
 * zero, and where the fights stop being fights. Reading one setting at a time
 * makes the first of those look like the answer.
 */
if (args.sweepAdjust) {
  const thumbs = args.sweepAdjust
  console.log(`\n${args.runs} runs per cell, policy "${args.policy}", stopping after level ${args.levels}\n`)
  console.log('preset     thumb   died   encounters won (p10/med/p90)   rounds/fight  damage/fight  level')
  for (const difficulty of presets) {
    for (const thumb of thumbs) {
      const row = sweep(difficulty, args.prefer, pinned, thumb)
      console.log(
        `${DIFFICULTY_LABELS[difficulty].padEnd(9)} ${`${Math.round(thumb * 100)}%`.padStart(5)}`
        + `${`${(row.deathRate * 100).toFixed(0)}%`.padStart(7)}   `
        + `${String(row.encountersWon.p10).padStart(3)} /${String(row.encountersWon.median).padStart(4)} /${String(row.encountersWon.p90).padStart(4)}`
        + `${row.roundsPerFight.toFixed(1).padStart(18)}${row.damagePerFight.toFixed(1).padStart(14)}`
        + `${row.levelReached.toFixed(1).padStart(7)}`,
      )
    }
    console.log('')
  }
  process.exit(0)
}

const report: Record<string, ReturnType<typeof summarize>> = {}
for (const difficulty of presets) {
  report[difficulty] = sweep(difficulty, args.prefer, pinned)
}

if (args.json) {
  console.log(JSON.stringify({ policy: args.policy, runs: args.runs, levels: args.levels, report }, null, 2))
} else {
  const percent = (value: number) => `${(value * 100).toFixed(0)}%`
  console.log(`\n${args.runs} runs per preset, policy "${args.policy}", stopping after level ${args.levels}\n`)
  console.log('preset    died   encounters won (p10/med/p90)   rounds/fight  damage/fight  level  gold  motes')
  for (const difficulty of presets) {
    const row = report[difficulty]
    console.log(
      `${DIFFICULTY_LABELS[difficulty].padEnd(9)} ${percent(row.deathRate).padStart(4)}   `
      + `${String(row.encountersWon.p10).padStart(3)} /${String(row.encountersWon.median).padStart(4)} /${String(row.encountersWon.p90).padStart(4)}`
      + `${row.roundsPerFight.toFixed(1).padStart(18)}${row.damagePerFight.toFixed(1).padStart(14)}`
      + `${row.levelReached.toFixed(1).padStart(7)}${row.gold.toFixed(1).padStart(6)}${row.motes.toFixed(1).padStart(7)}`,
    )
  }
  console.log('')
}
