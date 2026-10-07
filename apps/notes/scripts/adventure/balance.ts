// THE STRATEGY REPORT: how far each kind of player gets, where it dies, what
// it earns on the way, and which choices it actually makes.
//
//   npm run adventure:balance                       (writes balance-report.md)
//   npm run adventure:balance -- --out=path.md --runs=300 --clever-runs=60
//
// simulate.ts asks "what is THIS worth" by pinning one thing at a time; this
// asks "how does the game play" by letting several players loose on the same
// seeds. The players are runner.ts's policies -- `first` (always the default
// cell, the walk the tests use), `random`, `careful` (a stated rule of thumb)
// and `clever` (a lookahead that plays the best choice for the hand it is
// dealt without seeing the dice). The gap between them is the finding: a game
// where `clever` does no better than `first` has no meaningful choices, and
// one where `clever` walks through has no wall.
//
// Flags: --runs (per cheap policy, default 200), --clever-runs (default 40:
//        the lookahead costs ~1000x a step), --samples (futures per clever
//        candidate, default 4), --progression (default the minimum),
//        --success-adjust, --levels (cap, default 12), --policies=a,b,
//        --seed, --workers (default: CPU count), --out, --json.
//
// Every run is seeded by its index, so policy A's run 7 and policy B's run 7
// begin from the same game: rows differ by the player, not by the deal.

import { spawn } from 'node:child_process'
import { availableParallelism } from 'node:os'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PROGRESSION_MIN } from '../../src/adventure/model/difficulty'
import { POLICIES, clever, playRun, type Policy, type PolicyName, type RunResult, type VectorPin } from './runner'

interface Args {
  runs: number
  cleverRuns: number
  samples: number
  progression: number
  successAdjust: number
  levels: number
  policies: PolicyName[]
  seed: number
  workers: number
  out: string
  json: boolean
  shard: [number, number] | null
  /** `--pin=class:juggler`: every run is that vector, overriding what creation picked. */
  pin: VectorPin | null
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    runs: 200, cleverRuns: 40, samples: 4, progression: PROGRESSION_MIN, successAdjust: 0, levels: 12,
    policies: ['first', 'random', 'careful', 'clever'], seed: 1, workers: availableParallelism(),
    out: 'balance-report.md', json: false, shard: null, pin: null,
  }
  for (const raw of argv) {
    const [key, value = ''] = raw.replace(/^--/, '').split('=')
    if (key === 'runs') args.runs = Number(value)
    else if (key === 'clever-runs') args.cleverRuns = Number(value)
    else if (key === 'samples') args.samples = Number(value)
    else if (key === 'progression') args.progression = Number(value)
    else if (key === 'success-adjust') args.successAdjust = Number(value)
    else if (key === 'levels') args.levels = Number(value)
    else if (key === 'policies') args.policies = value.split(',').filter(Boolean) as PolicyName[]
    else if (key === 'seed') args.seed = Number(value)
    else if (key === 'workers') args.workers = Math.max(1, Number(value))
    else if (key === 'out') args.out = value
    else if (key === 'json') args.json = true
    else if (key === 'pin') {
      const [vector, id] = value.split(':')
      args.pin = { vector: vector as VectorPin['vector'], id, name: id }
    } else if (key === 'shard') {
      const [index, count] = value.split('/').map(Number)
      args.shard = [index, count]
    }
  }
  for (const name of args.policies) {
    if (!(name in POLICIES)) throw new Error(`unknown policy "${name}" -- one of ${Object.keys(POLICIES).join(', ')}`)
  }
  return args
}

/** Every (policy, run) pair, in a fixed order, so a shard is a stable slice of it. */
function jobsOf(args: Args): { policy: PolicyName; index: number }[] {
  return args.policies.flatMap((policy) => {
    const count = policy === 'clever' ? args.cleverRuns : args.runs
    return Array.from({ length: count }, (_, index) => ({ policy, index }))
  })
}

const policyOf = (args: Args, name: PolicyName): Policy => (
  name === 'clever' ? clever({ samples: args.samples }) : POLICIES[name]
)

/** Pick counts, keyed `stage|choice`: how often a choice was on screen and how often taken. */
type Tally = Record<string, { offered: number; taken: number }>

interface ShardOutput {
  runs: Record<string, Omit<RunResult, 'decisions'>[]>
  tallies: Record<string, Tally>
}

/** `hunt:0` and `hunt:1` name a SLOT, not a monster -- read their rates as "first or second offer". */
const tallyKey = (stageId: string, choiceId: string) => `${stageId}|${choiceId}`

function runShard(args: Args, shard: [number, number]): ShardOutput {
  const output: ShardOutput = { runs: {}, tallies: {} }
  jobsOf(args).forEach((job, position) => {
    if (position % shard[1] !== shard[0]) return
    const result = playRun({
      runSeed: args.seed + job.index * 7919,
      progression: args.progression,
      successAdjust: args.successAdjust,
      policy: policyOf(args, job.policy),
      levelCap: args.levels,
      recordDecisions: true,
      vectors: args.pin ? [args.pin] : undefined,
    })
    const tally = (output.tallies[job.policy] ??= {})
    for (const decision of result.decisions) {
      for (const offered of decision.offered) {
        const key = tallyKey(decision.stageId, offered)
        tally[key] ??= { offered: 0, taken: 0 }
        tally[key].offered += 1
        if (offered === decision.taken) tally[key].taken += 1
      }
    }
    const { decisions: _decisions, ...rest } = result
    ;(output.runs[job.policy] ??= []).push(rest)
  })
  return output
}

function spawnShard(argv: string[], shard: [number, number]): Promise<ShardOutput> {
  const script = fileURLToPath(import.meta.url)
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['vite-node', script, '--', ...argv, `--shard=${shard[0]}/${shard[1]}`], {
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    let text = ''
    child.stdout.on('data', (chunk) => { text += chunk })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`shard ${shard[0]} exited ${code}`))
      resolve(JSON.parse(text.slice(text.indexOf('{'))) as ShardOutput)
    })
  })
}

function merge(outputs: ShardOutput[]): ShardOutput {
  const merged: ShardOutput = { runs: {}, tallies: {} }
  for (const output of outputs) {
    for (const [policy, runs] of Object.entries(output.runs)) (merged.runs[policy] ??= []).push(...runs)
    for (const [policy, tally] of Object.entries(output.tallies)) {
      const into = (merged.tallies[policy] ??= {})
      for (const [key, counts] of Object.entries(tally)) {
        into[key] ??= { offered: 0, taken: 0 }
        into[key].offered += counts.offered
        into[key].taken += counts.taken
      }
    }
  }
  return merged
}

// ---- the report ----------------------------------------------------------

const mean = (values: number[]) => (values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length)
const quantile = (values: number[], fraction: number) => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))]
}
const pct = (value: number) => `${(value * 100).toFixed(0)}%`
const fixed = (value: number, digits = 1) => value.toFixed(digits)
const table = (head: string[], rows: (string | number)[][]) => [
  `| ${head.join(' | ')} |`,
  `|${head.map(() => '---').join('|')}|`,
  ...rows.map((row) => `| ${row.join(' | ')} |`),
].join('\n')

type Run = Omit<RunResult, 'decisions'>

/** Encounter milestones the survival curve is read at. */
const PROGRESS_MARKS = [1, 2, 3, 5, 7, 10, 15, 20, 30, 50, 80, 110]

function report(args: Args, data: ShardOutput): string {
  const names = args.policies.filter((name) => data.runs[name])
  const lines: string[] = []
  lines.push('# ThockQuest balance report')
  lines.push('')
  lines.push(`Progression x${args.progression.toFixed(2)}, luckiness ${pct(args.successAdjust)}, level cap ${args.levels},`
    + ` ${args.runs} runs per policy (clever: ${args.cleverRuns}, ${args.samples} futures per candidate).`
    + ' Regenerate with `npm run adventure:balance`. A level is ten encounters, so progress 10 is level one cleared.')
  lines.push('')

  lines.push('## Outcome by policy')
  lines.push('')
  lines.push(table(
    ['policy', 'runs', 'died', 'progress p10/med/p90', 'mean', 'level', 'fights', 'actions/fight', 'damage/fight', 'gold', 'motes'],
    names.map((name) => {
      const runs = data.runs[name]
      const progress = runs.map((run) => run.progress)
      return [
        name, runs.length, pct(mean(runs.map((run) => (run.died ? 1 : 0)))),
        `${quantile(progress, 0.1)} / ${quantile(progress, 0.5)} / ${quantile(progress, 0.9)}`, fixed(mean(progress)),
        fixed(mean(runs.map((run) => run.level))), fixed(mean(runs.map((run) => run.fights))),
        fixed(mean(runs.map((run) => (run.fights ? run.actions / run.fights : 0)))),
        fixed(mean(runs.map((run) => (run.fights ? run.damageTaken / run.fights : 0)))),
        fixed(mean(runs.map((run) => run.gold))), fixed(mean(runs.map((run) => run.motes))),
      ]
    }),
  ))
  lines.push('')

  lines.push('## Survival curve (share of runs with at least N encounters behind them)')
  lines.push('')
  lines.push(table(['policy', ...PROGRESS_MARKS.map(String)], names.map((name) => {
    const runs = data.runs[name]
    return [name, ...PROGRESS_MARKS.map((mark) => pct(mean(runs.map((run) => (run.progress >= mark ? 1 : 0)))))]
  })))
  lines.push('')

  lines.push('## Where runs die (stage on screen at the killing choice)')
  lines.push('')
  lines.push(table(['policy', 'deaths by stage'], names.map((name) => {
    const counts: Record<string, number> = {}
    for (const run of data.runs[name]) if (run.died) counts[run.diedIn ?? '?'] = (counts[run.diedIn ?? '?'] ?? 0) + 1
    return [name, Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([stage, count]) => `${stage} ${count}`).join(', ') || '-']
  })))
  lines.push('')

  lines.push('## Reward curve (mean state on entering each level, over runs that got there)')
  lines.push('')
  for (const name of names) {
    const byLevel = new Map<number, Run['levels']>()
    for (const run of data.runs[name]) for (const snap of run.levels) byLevel.set(snap.level, [...(byLevel.get(snap.level) ?? []), snap])
    if (byLevel.size < 2) continue
    lines.push(`**${name}**`)
    lines.push('')
    lines.push(table(['level', 'runs', 'health', 'motes', 'gold', 'stat pts', 'fame buys', 'items', 'traits'],
      [...byLevel.entries()].sort((a, b) => a[0] - b[0]).map(([level, snaps]) => [
        level, snaps.length, pct(mean(snaps.map((s) => s.health))), fixed(mean(snaps.map((s) => s.experience))),
        fixed(mean(snaps.map((s) => s.gold))), fixed(mean(snaps.map((s) => s.statPointsSpent))),
        fixed(mean(snaps.map((s) => s.famePurchases))), fixed(mean(snaps.map((s) => s.items))), fixed(mean(snaps.map((s) => s.traits))),
      ])))
    lines.push('')
  }

  lines.push('## Vectors: mean progress by what the run played')
  lines.push('')
  lines.push('Only meaningful for a policy that chooses its vectors (`clever` picks them by lookahead; `first` always takes the first dealt).')
  lines.push('')
  for (const name of names) {
    for (const vector of ['build', 'species', 'class'] as const) {
      const groups = new Map<string, number[]>()
      for (const run of data.runs[name]) {
        const id = run.vectors?.[vector]
        if (id) groups.set(id, [...(groups.get(id) ?? []), run.progress])
      }
      if (groups.size === 0) continue
      const rows = [...groups.entries()].map(([id, values]) => [id, values.length, fixed(mean(values))] as const)
        .sort((a, b) => Number(b[2]) - Number(a[2]))
      lines.push(`${name} / ${vector}: ${rows.map(([id, count, value]) => `${id} ${value} (${count})`).join(', ')}`)
      lines.push('')
    }
  }

  lines.push('## Pick rates (taken / offered, decisions with more than one choice)')
  lines.push('')
  lines.push('A choice the lookahead almost never takes when offered is dead or dominated; one it almost always takes is dominant.')
  lines.push('')
  for (const name of names) {
    const tally = data.tallies[name] ?? {}
    const byStage = new Map<string, [string, { offered: number; taken: number }][]>()
    for (const [key, counts] of Object.entries(tally)) {
      const [stage, choice] = key.split('|')
      byStage.set(stage, [...(byStage.get(stage) ?? []), [choice, counts]])
    }
    lines.push(`### ${name}`)
    lines.push('')
    for (const [stage, rows] of [...byStage.entries()].sort()) {
      const sorted = rows.filter(([, c]) => c.offered >= 3).sort((a, b) => b[1].taken / b[1].offered - a[1].taken / a[1].offered)
      if (sorted.length === 0) continue
      lines.push(`- **${stage}**: ${sorted.map(([choice, c]) => `${choice} ${pct(c.taken / c.offered)} of ${c.offered}`).join(', ')}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

const argv = process.argv.slice(2).filter((arg) => arg !== '--')
const args = parseArgs(argv)
if (args.shard) {
  process.stdout.write(JSON.stringify(runShard(args, args.shard)))
} else {
  const started = Date.now()
  const shards = Array.from({ length: args.workers }, (_, index) => spawnShard(argv, [index, args.workers]))
  const data = merge(await Promise.all(shards))
  if (args.json) {
    console.log(JSON.stringify(data))
  } else {
    const text = report(args, data)
    writeFileSync(args.out, `${text}\n`)
    console.log(text.split('## Survival curve')[0])
    console.log(`wrote ${args.out} in ${((Date.now() - started) / 1000).toFixed(0)}s`)
  }
}
