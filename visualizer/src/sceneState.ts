/**
 * Parameter-driven description of the Treesearch scene.
 *
 * The field is a top-down plane: `x` runs left→right, `y` runs
 * front→back (toward/away from the camera). One unit ≈ one metre.
 *
 * A scene can be a single snapshot (`SceneState`) or, for playback, a
 * *timeline* of snapshots (`Timeline`) that the visualizer animates between so
 * trees appear to grow, sprout, and change health over time.
 *
 * The preferred feed format is a JSON **array of days** (`RunState.days`), where
 * each day carries tree state, the agent's next action(s), and environment state
 * so the entire UI can be driven from one file.
 */

export type Trend = 'up' | 'down' | 'flat'

/** Rubber-tree life stage (matches Farm.objects.RubberTree.stage). */
export type TreeStage = 'seedling' | 'young' | 'mature' | 'tapping' | 'dead'

/** MCP farm tools exposed to the agent (see luke-treesearch/env.py). */
export type FarmTool =
  | 'observe'
  | 'render'
  | 'status'
  | 'water'
  | 'fertilize'
  | 'tap'
  | 'advance'
  | 'quote'
  | 'simulate'

export interface StateMetric {
  key: string
  label: string
  value: number
  unit: string
  /** Healthy operating range, used to flag out-of-range values. */
  range: [number, number]
  trend: Trend
}

export interface AgentAction {
  id: string
  /** Tool name shown in the actions panel (Water, Tap, Advance, …). */
  label: string
  detail: string
  /** Model confidence in this action, 0-1. */
  confidence: number
  /** When set, identifies the farm MCP tool this action maps to. */
  tool?: FarmTool
}

/** Farm snapshot metadata — mirrors Farm.observe() top-level fields. */
export interface EnvironmentState {
  crop?: string
  year?: number
  day?: number
  dayOfYear?: number
  yearsLeft?: number
  finished?: boolean
  /** Legacy step index for uploaded runs that omit calendar fields. */
  episode?: number
  step?: number
  metrics: StateMetric[]
}

/**
 * One day in a run: tree field state, proposed agent action(s), and environment.
 * This is the element shape of the top-level JSON array feed.
 */
export interface DayRecord {
  label?: string
  trees: SceneState
  nextAction: AgentAction[]
  environment: EnvironmentState
}

/** Full run state compiled from a JSON feed. */
export interface RunState {
  field?: { size?: number }
  days: DayRecord[]
}

export interface TreeState {
  /** Optional stable id — also seeds this tree's random shape. */
  id?: string
  /** Grid row (farm simulation coordinate). */
  row?: number
  /** Grid column (farm simulation coordinate). */
  col?: number
  /** Field position, left→right. */
  x: number
  /** Field position, front→back. */
  y: number
  /** Trunk girth in cm (Farm.objects.RubberTree.girth_cm). Drives size when set. */
  girthCm?: number
  /** Overall scale. 1 ≈ reference girth (~50 cm). Default 1. */
  size?: number
  /** Health/lushness in [0,1]: 1 = full green canopy, 0 = sparse & yellowed. Default 1. */
  health?: number
  /** Life stage for legend / filtering. */
  stage?: TreeStage
  /** Whether latex tapping is active on this tree. */
  tapping?: boolean
  /** False when the tree has died of age or poor health. */
  alive?: boolean
}

export interface SceneState {
  /** Field extent in metres (square, centred on the origin). Default 44. */
  field?: { size?: number }
  trees: TreeState[]
}

/** One snapshot in a timeline: a scene state plus an optional display label. */
export interface Frame extends SceneState {
  /** Short label shown on the scrubber, e.g. "Day 3" or "Step 12". */
  label?: string
}

/** An ordered sequence of frames the visualizer plays through. */
export interface Timeline {
  /** Field extent, shared across frames unless a frame overrides it. */
  field?: { size?: number }
  frames: Frame[]
}

/** A normalised tree with all defaults resolved and values clamped. */
export interface ResolvedTree {
  id: string
  x: number
  y: number
  size: number
  health: number
  seed: number
}

const MAX_TREES = 300
const MAX_FRAMES = 500

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n))
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

/** Smooth ease-in-out on [0,1] for organic-looking growth. */
function smoothstep(t: number) {
  return t * t * (3 - 2 * t)
}

/** Deterministic 32-bit hash of a string, used to seed a tree's shape. */
function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Reference girth for a mature tree in the farm model (cm). */
export const REFERENCE_GIRTH_CM = 50

export function girthToSize(girthCm: number): number {
  return clamp(girthCm / REFERENCE_GIRTH_CM, 0.08, 1.4)
}

export function resolveTrees(state: SceneState): ResolvedTree[] {
  return state.trees
    .filter((t) => t.alive !== false && t.stage !== 'dead')
    .map((t, i) => {
      const id = t.id ?? `tree-${i}`
      const sizeFromGirth = t.girthCm !== undefined ? girthToSize(t.girthCm) : undefined
      return {
        id,
        x: t.x,
        y: t.y,
        size: clamp(sizeFromGirth ?? t.size ?? 1, 0.08, 4),
        health: clamp(t.health ?? 1, 0, 1),
        seed: hashString(id),
      }
    })
}

export function fieldSize(state: SceneState): number {
  return clamp(state.field?.size ?? 44, 8, 200)
}

/* ------------------------------------------------------------------ */
/* Timeline → animation tracks                                        */
/* ------------------------------------------------------------------ */

/** A single tree's resolved values at one frame. */
export interface TreeSample {
  x: number
  y: number
  size: number
  health: number
}

/**
 * One tree across the whole timeline. `samples[i]` is the tree's state at frame
 * `i`, or `null` if the tree doesn't exist in that frame (not yet planted, or
 * already removed). Trees are matched across frames by `id`.
 */
export interface TreeTrack {
  id: string
  seed: number
  samples: (TreeSample | null)[]
}

/** A timeline compiled into the form the renderer consumes. */
export interface CompiledTimeline {
  /** Half the field extent in metres (used to size the soil plot). */
  fieldHalf: number
  frameCount: number
  /** Per-frame scrubber labels. */
  labels: string[]
  tracks: TreeTrack[]
}

/**
 * Compile a timeline into per-tree tracks: the union of every tree id seen in
 * any frame, each carrying a sample (or `null`) for every frame. This is what
 * lets a tree grow in over time and lets later frames introduce new trees.
 */
export function compileTimeline(tl: Timeline): CompiledTimeline {
  const frames = tl.frames.length ? tl.frames : [{ trees: [] }]
  const frameCount = frames.length

  const fieldFromFrame = frames.find((f) => f.field?.size !== undefined)?.field?.size
  const fieldHalf = clamp(tl.field?.size ?? fieldFromFrame ?? 44, 8, 200) / 2

  const order: string[] = []
  const indexById = new Map<string, number>()
  const resolved = frames.map((f) =>
    resolveTrees({ field: f.field ?? tl.field, trees: f.trees }),
  )

  for (const rf of resolved) {
    for (const t of rf) {
      if (!indexById.has(t.id)) {
        indexById.set(t.id, order.length)
        order.push(t.id)
      }
    }
  }

  const tracks: TreeTrack[] = order.map((id) => ({
    id,
    seed: hashString(id),
    samples: new Array(frameCount).fill(null),
  }))

  resolved.forEach((rf, fi) => {
    for (const t of rf) {
      const ti = indexById.get(t.id)!
      tracks[ti].samples[fi] = { x: t.x, y: t.y, size: t.size, health: t.health }
    }
  })

  const labels = frames.map((f, i) => f.label ?? `Day ${i}`)
  return { fieldHalf, frameCount, labels, tracks }
}

/** Derive a tree timeline from a multi-day run for the 3D renderer. */
export function runToTimeline(run: RunState): Timeline {
  const days = run.days.length ? run.days : [{ trees: { trees: [] }, nextAction: [], environment: { metrics: [] } }]
  const fieldFromDay = days.find((d) => d.trees.field?.size !== undefined)?.trees.field?.size
  return {
    field: run.field ?? (fieldFromDay !== undefined ? { size: fieldFromDay } : undefined),
    frames: days.map((d, i) => ({
      label: d.label ?? `Day ${i}`,
      field: d.trees.field ?? run.field,
      trees: d.trees.trees,
    })),
  }
}

/** Environment + actions for the day nearest `dayIndex`. */
export function dayAt(run: RunState, dayIndex: number): DayRecord | null {
  if (run.days.length === 0) return null
  const i = Math.min(run.days.length - 1, Math.max(0, Math.round(dayIndex)))
  return run.days[i] ?? null
}

/** True when an agent action is the farm `water` tool. */
export function isWateringAction(action: AgentAction): boolean {
  if (action.tool === 'water') return true
  const text = `${action.label} ${action.detail}`.toLowerCase()
  return /\b(water|irrigation|irrigate)\b/.test(text)
}

/** Per-day flag: top-confidence next action is watering. */
export function wateringFlagsFromRun(run: RunState): boolean[] {
  return run.days.map((day) => {
    const top = day.nextAction[0]
    return top !== undefined && isWateringAction(top)
  })
}

/** Mutable playback state shared between the DOM controls and the render loop. */
export interface PlaybackClock {
  /** Continuous playhead in day units (0 .. frameCount-1). Fractional part = time of day. */
  t: number
  playing: boolean
  /** Playback rate, in days per second. */
  speed: number
  /** When set, the render loop jumps the playhead here and clears it. */
  seek: number | null
}

/** Blend watering activity across fractional playhead `t` (0 = off, 1 = on). */
export function sampleWatering(flags: boolean[], t: number): number {
  if (flags.length === 0) return 0
  const i = clamp(Math.floor(t), 0, flags.length - 1)
  const j = Math.min(flags.length - 1, i + 1)
  const f = clamp(t - i, 0, 1)
  const a = flags[i] ? 1 : 0
  const b = flags[j] ? 1 : 0
  return lerp(a, b, smoothstep(f))
}

/** A tree's interpolated state at a fractional playhead `t` (in frame units). */
export interface TreeRender {
  x: number
  y: number
  size: number
  health: number
  /** False when the tree is absent/too small to draw at this instant. */
  visible: boolean
}

const HIDDEN: TreeRender = { x: 0, y: 0, size: 0, health: 1, visible: false }

/**
 * Sample a track at a continuous playhead `t`, where the integer part is the
 * frame index and the fraction blends toward the next frame. Trees that are
 * absent in one of the two surrounding frames grow in from / shrink out to
 * size 0, so planting and removal animate smoothly.
 */
export function sampleTrack(track: TreeTrack, t: number): TreeRender {
  const n = track.samples.length
  if (n === 0) return HIDDEN

  const i = clamp(Math.floor(t), 0, n - 1)
  const j = Math.min(n - 1, i + 1)
  const f = clamp(t - i, 0, 1)
  const a = track.samples[i]
  const b = track.samples[j]

  if (!a && !b) return HIDDEN
  if (a && !b) {
    const size = lerp(a.size, 0, smoothstep(f))
    return { x: a.x, y: a.y, size, health: a.health, visible: size > 0.01 }
  }
  if (!a && b) {
    const size = lerp(0, b.size, smoothstep(f))
    return { x: b.x, y: b.y, size, health: b.health, visible: size > 0.01 }
  }

  const e = smoothstep(f)
  const size = lerp(a!.size, b!.size, e)
  return {
    x: lerp(a!.x, b!.x, e),
    y: lerp(a!.y, b!.y, e),
    size,
    health: lerp(a!.health, b!.health, e),
    visible: size > 0.01,
  }
}

/* ------------------------------------------------------------------ */
/* Parsing + validation                                               */
/* ------------------------------------------------------------------ */

type Result<T> = { value: T; error: null } | { value: null; error: string }

const FARM_TOOLS = new Set<FarmTool>([
  'observe',
  'render',
  'status',
  'water',
  'fertilize',
  'tap',
  'advance',
  'quote',
  'simulate',
])

const TREE_STAGES = new Set<TreeStage>(['seedling', 'young', 'mature', 'tapping', 'dead'])
const TRENDS = new Set<Trend>(['up', 'down', 'flat'])

function validateFarmTool(raw: unknown, where: string): Result<FarmTool | undefined> {
  if (raw === undefined) return { value: undefined, error: null }
  if (typeof raw !== 'string' || !FARM_TOOLS.has(raw as FarmTool)) {
    return { value: null, error: `${where} must be a farm tool name.` }
  }
  return { value: raw as FarmTool, error: null }
}

/** Default metrics/actions used when legacy timeline JSON omits them. */
export const defaultEnvironment = (step = 0): EnvironmentState => ({
  crop: 'Rubber plantation',
  year: 2025 + step,
  day: step * 365,
  dayOfYear: 0,
  yearsLeft: 30 - step,
  finished: false,
  step,
  metrics: defaultMetrics(step),
})

function trendFromDelta(delta: number): Trend {
  if (delta > 0.005) return 'up'
  if (delta < -0.005) return 'down'
  return 'flat'
}

/** Build metrics from a farm observe()-shaped snapshot. */
export function farmMetrics(
  obs: {
    averages?: Partial<Record<'age_years' | 'girth_cm' | 'health' | 'panel_health' | 'moisture' | 'nutrients', number>>
    trees?: Partial<Record<'total' | 'living' | 'tappable' | 'tapping', number>>
    economics?: Partial<
      Record<'revenue' | 'cost' | 'profit' | 'latex_lb' | 'water_gallons' | 'fertilizer_units', number>
    >
    budget?: Partial<Record<'annual' | 'spent_this_year' | 'remaining_this_year', number>>
    prices?: Partial<Record<'rubber_per_lb' | 'water_per_gallon' | 'fertilizer_per_unit', number>>
  },
  prev?: StateMetric[],
): StateMetric[] {
  const prevVal = (key: string, fallback: number) =>
    prev?.find((m) => m.key === key)?.value ?? fallback

  const a = obs.averages ?? {}
  const t = obs.trees ?? {}
  const e = obs.economics ?? {}
  const b = obs.budget ?? {}
  const p = obs.prices ?? {}

  const defs: Omit<StateMetric, 'trend'>[] = [
    { key: 'profit', label: 'Profit', value: e.profit ?? 0, unit: '$', range: [-500, 5000] },
    { key: 'revenue', label: 'Revenue', value: e.revenue ?? 0, unit: '$', range: [0, 6000] },
    { key: 'cost', label: 'Cost', value: e.cost ?? 0, unit: '$', range: [0, 800] },
    { key: 'latex_lb', label: 'Rubber harvested', value: e.latex_lb ?? 0, unit: 'lb', range: [0, 4000] },
    { key: 'budget_remaining', label: 'Budget left', value: b.remaining_this_year ?? 800, unit: '$', range: [0, 800] },
    { key: 'budget_spent', label: 'Budget spent', value: b.spent_this_year ?? 0, unit: '$', range: [0, 800] },
    { key: 'living', label: 'Living trees', value: t.living ?? 36, unit: '', range: [0, 36] },
    { key: 'tappable', label: 'Tappable trees', value: t.tappable ?? 0, unit: '', range: [0, 36] },
    { key: 'tapping', label: 'Trees tapping', value: t.tapping ?? 0, unit: '', range: [0, 36] },
    { key: 'age_years', label: 'Avg age', value: a.age_years ?? 0, unit: 'y', range: [0, 34] },
    { key: 'girth_cm', label: 'Avg girth', value: a.girth_cm ?? 3, unit: 'cm', range: [3, 70] },
    { key: 'health', label: 'Avg health', value: a.health ?? 1, unit: '', range: [0.35, 1] },
    { key: 'panel_health', label: 'Tapping panel', value: a.panel_health ?? 1, unit: '', range: [0.4, 1] },
    { key: 'moisture', label: 'Soil moisture', value: a.moisture ?? 0.5, unit: '', range: [0.35, 1] },
    { key: 'nutrients', label: 'Soil nutrients', value: a.nutrients ?? 0.5, unit: '', range: [0.25, 1] },
    { key: 'rubber_price', label: 'Rubber price', value: p.rubber_per_lb ?? 0.9, unit: '$/lb', range: [0.2, 1.5] },
    { key: 'water_price', label: 'Water price', value: p.water_per_gallon ?? 0.004, unit: '$/gal', range: [0.0005, 0.01] },
    {
      key: 'fertilizer_price',
      label: 'Fertilizer price',
      value: p.fertilizer_per_unit ?? 2.5,
      unit: '$/unit',
      range: [0.5, 4],
    },
  ]

  return defs.map((d) => {
    const decimals =
      d.unit === '$/lb' || d.unit === '$/gal' || d.unit === '$/unit'
        ? 4
        : d.unit === '' && (d.key.includes('health') || d.key === 'moisture' || d.key === 'nutrients')
          ? 3
          : 2
    const value = Number(d.value.toFixed(decimals))
    return {
      ...d,
      value,
      trend: trendFromDelta(value - prevVal(d.key, value)),
    }
  })
}

export function defaultMetrics(step = 0): StateMetric[] {
  const wobble = (base: number, amp: number) => base + Math.sin(step * 0.31) * amp
  return farmMetrics({
    averages: {
      age_years: Number(wobble(4.7, 0.4).toFixed(2)),
      girth_cm: Number(wobble(40, 3).toFixed(2)),
      health: Number(clamp(wobble(0.88, 0.08), 0.35, 1).toFixed(3)),
      panel_health: Number(clamp(1 - step * 0.015, 0.5, 1).toFixed(3)),
      moisture: Number(clamp(wobble(0.55, 0.12), 0.2, 1).toFixed(3)),
      nutrients: Number(clamp(wobble(0.52, 0.15), 0.15, 1).toFixed(3)),
    },
    trees: { total: 36, living: 36, tappable: Math.min(36, 8 + step * 2), tapping: Math.min(36, step * 2) },
    economics: {
      revenue: Number((step * 85).toFixed(2)),
      cost: Number((step * 12).toFixed(2)),
      profit: Number((step * 73).toFixed(2)),
      latex_lb: Number((step * 95).toFixed(2)),
      water_gallons: Number((step * 18).toFixed(1)),
      fertilizer_units: Number((step * 4.2).toFixed(2)),
    },
    budget: { annual: 800, spent_this_year: Number((step * 12).toFixed(2)), remaining_this_year: Number((800 - step * 12).toFixed(2)) },
    prices: {
      rubber_per_lb: Number((0.88 - step * 0.008).toFixed(4)),
      water_per_gallon: Number((0.0037 + step * 0.00005).toFixed(4)),
      fertilizer_per_unit: Number((2.53 - step * 0.02).toFixed(4)),
    },
  })
}

export function defaultNextActions(step = 0): AgentAction[] {
  const moistureLow = step % 4 === 1
  const nutrientsLow = step % 5 === 2
  const actions: AgentAction[] = [
    {
      id: 'advance',
      label: 'Advance',
      detail: '365 days',
      confidence: 0.91,
      tool: 'advance',
    },
    {
      id: 'tap',
      label: 'Tap',
      detail: 'Start tapping mature trees',
      confidence: step < 2 ? 0.55 : 0.84,
      tool: 'tap',
    },
    {
      id: 'simulate',
      label: 'Simulate',
      detail: 'Dry-run multi-year plan on a copy',
      confidence: 0.48,
      tool: 'simulate',
    },
    {
      id: 'observe',
      label: 'Observe',
      detail: 'JSON snapshot of the whole farm',
      confidence: 0.35,
      tool: 'observe',
    },
  ]
  if (moistureLow) {
    return [
      {
        id: 'water',
        label: 'Water',
        detail: '5 gal/tree on all',
        confidence: 0.86,
        tool: 'water',
      },
      ...actions.slice(1),
    ]
  }
  if (nutrientsLow) {
    return [
      {
        id: 'fertilize',
        label: 'Fertilize',
        detail: 'N0.2 P0.15 K0.15 on all',
        confidence: 0.78,
        tool: 'fertilize',
      },
      ...actions.slice(1),
    ]
  }
  if (step % 6 === 0) {
    return [
      {
        id: 'quote',
        label: 'Quote',
        detail: 'Preview fertilize cost before spending',
        confidence: 0.62,
        tool: 'quote',
      },
      ...actions,
    ]
  }
  return actions
}

function validateField(raw: unknown, where: string): Result<SceneState['field']> {
  if (raw === undefined) return { value: undefined, error: null }
  if (typeof raw !== 'object' || raw === null) {
    return { value: null, error: `${where} must be an object.` }
  }
  const f = raw as Record<string, unknown>
  if (f.size !== undefined && (typeof f.size !== 'number' || !Number.isFinite(f.size))) {
    return { value: null, error: `${where}.size must be a number.` }
  }
  return { value: { size: f.size as number | undefined }, error: null }
}

function validateTrees(raw: unknown, where: string): Result<TreeState[]> {
  if (!Array.isArray(raw)) return { value: null, error: `${where} must be an array.` }
  if (raw.length > MAX_TREES) {
    return { value: null, error: `Too many trees in ${where} (max ${MAX_TREES}).` }
  }
  const trees: TreeState[] = []
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i]
    if (typeof item !== 'object' || item === null) {
      return { value: null, error: `${where}[${i}] must be an object.` }
    }
    const t = item as Record<string, unknown>
    if (typeof t.x !== 'number' || !Number.isFinite(t.x)) {
      return { value: null, error: `${where}[${i}].x must be a number.` }
    }
    if (typeof t.y !== 'number' || !Number.isFinite(t.y)) {
      return { value: null, error: `${where}[${i}].y must be a number.` }
    }
    for (const k of ['size', 'health', 'girthCm', 'row', 'col'] as const) {
      if (t[k] !== undefined && (typeof t[k] !== 'number' || !Number.isFinite(t[k] as number))) {
        return { value: null, error: `${where}[${i}].${k} must be a number.` }
      }
    }
    if (t.id !== undefined && typeof t.id !== 'string') {
      return { value: null, error: `${where}[${i}].id must be a string.` }
    }
    if (t.stage !== undefined && (typeof t.stage !== 'string' || !TREE_STAGES.has(t.stage as TreeStage))) {
      return { value: null, error: `${where}[${i}].stage must be a tree stage.` }
    }
    for (const k of ['tapping', 'alive'] as const) {
      if (t[k] !== undefined && typeof t[k] !== 'boolean') {
        return { value: null, error: `${where}[${i}].${k} must be a boolean.` }
      }
    }
    trees.push({
      id: t.id as string | undefined,
      row: t.row as number | undefined,
      col: t.col as number | undefined,
      x: t.x,
      y: t.y,
      girthCm: t.girthCm as number | undefined,
      size: t.size as number | undefined,
      health: t.health as number | undefined,
      stage: t.stage as TreeStage | undefined,
      tapping: t.tapping as boolean | undefined,
      alive: t.alive as boolean | undefined,
    })
  }
  return { value: trees, error: null }
}

function validateTrend(raw: unknown, where: string): Result<Trend> {
  if (typeof raw !== 'string' || !TRENDS.has(raw as Trend)) {
    return { value: null, error: `${where} must be "up", "down", or "flat".` }
  }
  return { value: raw as Trend, error: null }
}

function validateMetrics(raw: unknown, where: string): Result<StateMetric[]> {
  if (!Array.isArray(raw)) return { value: null, error: `${where} must be an array.` }
  const metrics: StateMetric[] = []
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i]
    if (typeof item !== 'object' || item === null) {
      return { value: null, error: `${where}[${i}] must be an object.` }
    }
    const m = item as Record<string, unknown>
    if (typeof m.key !== 'string') return { value: null, error: `${where}[${i}].key must be a string.` }
    if (typeof m.label !== 'string') return { value: null, error: `${where}[${i}].label must be a string.` }
    if (typeof m.value !== 'number' || !Number.isFinite(m.value)) {
      return { value: null, error: `${where}[${i}].value must be a number.` }
    }
    if (typeof m.unit !== 'string') return { value: null, error: `${where}[${i}].unit must be a string.` }
    if (!Array.isArray(m.range) || m.range.length !== 2) {
      return { value: null, error: `${where}[${i}].range must be a two-number array.` }
    }
    if (typeof m.range[0] !== 'number' || typeof m.range[1] !== 'number') {
      return { value: null, error: `${where}[${i}].range must contain numbers.` }
    }
    const trend = validateTrend(m.trend, `${where}[${i}].trend`)
    if (trend.error !== null) return trend
    metrics.push({
      key: m.key,
      label: m.label,
      value: m.value,
      unit: m.unit,
      range: [m.range[0], m.range[1]],
      trend: trend.value!,
    })
  }
  return { value: metrics, error: null }
}

function validateAgentAction(raw: unknown, where: string): Result<AgentAction> {
  if (typeof raw !== 'object' || raw === null) {
    return { value: null, error: `${where} must be an object.` }
  }
  const a = raw as Record<string, unknown>
  if (typeof a.id !== 'string') return { value: null, error: `${where}.id must be a string.` }
  if (typeof a.label !== 'string') return { value: null, error: `${where}.label must be a string.` }
  if (typeof a.detail !== 'string') return { value: null, error: `${where}.detail must be a string.` }
  if (typeof a.confidence !== 'number' || !Number.isFinite(a.confidence)) {
    return { value: null, error: `${where}.confidence must be a number.` }
  }
  const tool = validateFarmTool(a.tool, `${where}.tool`)
  if (tool.error !== null) return tool
  return {
    value: {
      id: a.id,
      label: a.label,
      detail: a.detail,
      confidence: clamp(a.confidence, 0, 1),
      tool: tool.value,
    },
    error: null,
  }
}

function validateNextAction(raw: unknown, where: string): Result<AgentAction[]> {
  if (Array.isArray(raw)) {
    const actions: AgentAction[] = []
    for (let i = 0; i < raw.length; i++) {
      const a = validateAgentAction(raw[i], `${where}[${i}]`)
      if (a.error !== null) return a
      actions.push(a.value!)
    }
    return { value: actions, error: null }
  }
  const single = validateAgentAction(raw, where)
  if (single.error !== null) return single
  return { value: [single.value!], error: null }
}

function validateEnvironment(raw: unknown, where: string): Result<EnvironmentState> {
  if (typeof raw !== 'object' || raw === null) {
    return { value: null, error: `${where} must be an object.` }
  }
  const e = raw as Record<string, unknown>
  const metrics = validateMetrics(e.metrics, `${where}.metrics`)
  if (metrics.error !== null) return metrics
  if (e.crop !== undefined && typeof e.crop !== 'string') {
    return { value: null, error: `${where}.crop must be a string.` }
  }
  for (const k of ['year', 'day', 'dayOfYear', 'yearsLeft', 'episode', 'step'] as const) {
    if (e[k] !== undefined && (typeof e[k] !== 'number' || !Number.isFinite(e[k] as number))) {
      return { value: null, error: `${where}.${k} must be a number.` }
    }
  }
  if (e.finished !== undefined && typeof e.finished !== 'boolean') {
    return { value: null, error: `${where}.finished must be a boolean.` }
  }
  return {
    value: {
      crop: e.crop as string | undefined,
      year: e.year as number | undefined,
      day: e.day as number | undefined,
      dayOfYear: e.dayOfYear as number | undefined,
      yearsLeft: e.yearsLeft as number | undefined,
      finished: e.finished as boolean | undefined,
      episode: e.episode as number | undefined,
      step: e.step as number | undefined,
      metrics: metrics.value!,
    },
    error: null,
  }
}

function validateSceneState(raw: unknown, where: string): Result<SceneState> {
  if (typeof raw !== 'object' || raw === null) {
    return { value: null, error: `${where} must be an object.` }
  }
  const obj = raw as Record<string, unknown>
  const field = validateField(obj.field, `${where}.field`)
  if (field.error !== null) return field
  const trees = validateTrees(obj.trees, `${where}.trees`)
  if (trees.error !== null) return trees
  return { value: { field: field.value, trees: trees.value! }, error: null }
}

function validateDayRecord(raw: unknown, where: string): Result<DayRecord> {
  if (typeof raw !== 'object' || raw === null) {
    return { value: null, error: `${where} must be an object.` }
  }
  const d = raw as Record<string, unknown>
  if (d.label !== undefined && typeof d.label !== 'string') {
    return { value: null, error: `${where}.label must be a string.` }
  }
  const trees = validateSceneState(d.trees, `${where}.trees`)
  if (trees.error !== null) return trees
  const nextAction = validateNextAction(d.nextAction, `${where}.nextAction`)
  if (nextAction.error !== null) return nextAction
  const environment = validateEnvironment(d.environment, `${where}.environment`)
  if (environment.error !== null) return environment
  return {
    value: {
      label: d.label as string | undefined,
      trees: trees.value!,
      nextAction: nextAction.value!,
      environment: environment.value!,
    },
    error: null,
  }
}

function frameToDay(frame: Frame, index: number): DayRecord {
  return {
    label: frame.label,
    trees: { field: frame.field, trees: frame.trees },
    nextAction: defaultNextActions(index),
    environment: defaultEnvironment(index),
  }
}

/**
 * Parse + validate a JSON blob into a full run state. Accepts:
 * - **Array of days** (preferred): `[{ trees, nextAction, environment }, ...]`
 * - Legacy timeline: `{ frames: [...] }` or single snapshot `{ trees: [...] }`
 */
export function parseRunState(text: string): { run: RunState | null; error: string | null } {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (e) {
    return { run: null, error: `Invalid JSON: ${(e as Error).message}` }
  }

  // Preferred: top-level array of day records.
  if (Array.isArray(data)) {
    if (data.length === 0) return { run: null, error: 'Array must have at least one day.' }
    if (data.length > MAX_FRAMES) {
      return { run: null, error: `Too many days (max ${MAX_FRAMES}).` }
    }
    const days: DayRecord[] = []
    for (let i = 0; i < data.length; i++) {
      const day = validateDayRecord(data[i], `[${i}]`)
      if (day.error !== null) return { run: null, error: day.error }
      days.push(day.value!)
    }
    const fieldFromDay = days.find((d) => d.trees.field?.size !== undefined)?.trees.field
    return { run: { field: fieldFromDay, days }, error: null }
  }

  if (typeof data !== 'object' || data === null) {
    return { run: null, error: 'Top level must be a JSON array of days or a legacy timeline object.' }
  }
  const obj = data as Record<string, unknown>

  const field = validateField(obj.field, '"field"')
  if (field.error !== null) return { run: null, error: field.error }

  // Legacy multi-frame timeline.
  if (obj.frames !== undefined) {
    if (!Array.isArray(obj.frames)) {
      return { run: null, error: '"frames" must be an array.' }
    }
    if (obj.frames.length === 0) {
      return { run: null, error: '"frames" must have at least one frame.' }
    }
    if (obj.frames.length > MAX_FRAMES) {
      return { run: null, error: `Too many frames (max ${MAX_FRAMES}).` }
    }
    const frames: Frame[] = []
    for (let i = 0; i < obj.frames.length; i++) {
      const item = obj.frames[i]
      if (typeof item !== 'object' || item === null) {
        return { run: null, error: `frames[${i}] must be an object.` }
      }
      const fr = item as Record<string, unknown>
      const trees = validateTrees(fr.trees, `frames[${i}].trees`)
      if (trees.error !== null) return { run: null, error: trees.error }
      const ff = validateField(fr.field, `frames[${i}].field`)
      if (ff.error !== null) return { run: null, error: ff.error }
      if (fr.label !== undefined && typeof fr.label !== 'string') {
        return { run: null, error: `frames[${i}].label must be a string.` }
      }
      frames.push({ label: fr.label as string | undefined, field: ff.value, trees: trees.value! })
    }
    return {
      run: { field: field.value, days: frames.map(frameToDay) },
      error: null,
    }
  }

  // Legacy single snapshot → one-day run.
  const trees = validateTrees(obj.trees, '"trees"')
  if (trees.error !== null) return { run: null, error: trees.error }
  const frame: Frame = { field: field.value, trees: trees.value! }
  return { run: { field: field.value, days: [frameToDay(frame, 0)] }, error: null }
}

/**
 * Parse + validate a JSON blob into a Timeline. Accepts either a multi-frame
 * timeline (`{ frames: [...] }`) or a single snapshot (`{ trees: [...] }`),
 * which is wrapped into a one-frame timeline. Returns an error string instead
 * of throwing.
 *
 * @deprecated Prefer `parseRunState` + `runToTimeline` for full UI state.
 */
export function parseTimeline(text: string): { timeline: Timeline | null; error: string | null } {
  const { run, error } = parseRunState(text)
  if (error !== null || run === null) return { timeline: null, error }
  return { timeline: runToTimeline(run), error: null }
}

/* ------------------------------------------------------------------ */
/* Example run timeline                                               */
/* ------------------------------------------------------------------ */

/** Deterministic [0,1) hash for stable per-tree variation. */
function frac(n: number) {
  const r = Math.sin(n * 97.13) * 43758.5453
  return r - Math.floor(r)
}

/** Number of yearly snapshots in the bundled example run (30-year horizon). */
export const EXAMPLE_YEAR_COUNT = 30

const MATURE_AGE_YEARS = 6
const MATURE_GIRTH_CM = 45
const SEEDLING_GIRTH_CM = 3
const MAX_GIRTH_CM = 70
const START_YEAR = 2025
const ANNUAL_BUDGET = 800

interface ExampleTree {
  row: number
  col: number
  /** Years of age when the run begins (0 = newly planted seedlings). */
  startAgeYears: number
  growthRate: number
  yieldMultiplier: number
  /** 1 = normal growth; lower = neglected plot that never fully matures (untrained only). */
  growthPotential: number
  tapping: boolean
  alive: boolean
}

function treeStage(ageYears: number, girthCm: number, tapping: boolean, alive: boolean): TreeStage {
  if (!alive) return 'dead'
  if (ageYears >= MATURE_AGE_YEARS && girthCm >= MATURE_GIRTH_CM) {
    return tapping ? 'tapping' : 'mature'
  }
  if (ageYears < 2) return 'seedling'
  return 'young'
}

function exampleFarmActions(
  yearIndex: number,
  moisture: number,
  nutrients: number,
  tappable: number,
): AgentAction[] {
  const base: AgentAction[] = [
    {
      id: 'advance',
      label: 'Advance',
      detail: '365 days',
      confidence: 0.91,
      tool: 'advance',
    },
    {
      id: 'tap',
      label: 'Tap',
      detail: tappable > 0 ? 'Start tapping mature trees' : 'No mature trees yet',
      confidence: tappable > 0 ? 0.84 : 0.35,
      tool: 'tap',
    },
    {
      id: 'simulate',
      label: 'Simulate',
      detail: 'Dry-run multi-year plan on a copy',
      confidence: 0.48,
      tool: 'simulate',
    },
    {
      id: 'status',
      label: 'Status',
      detail: 'Economics, prices, budget, years left',
      confidence: 0.32,
      tool: 'status',
    },
  ]
  if (moisture < 0.45) {
    return [
      {
        id: 'water',
        label: 'Water',
        detail: '5 gal/tree on all',
        confidence: 0.86,
        tool: 'water',
      },
      ...base.slice(1),
    ]
  }
  if (nutrients < 0.35) {
    return [
      {
        id: 'fertilize',
        label: 'Fertilize',
        detail: 'N0.2 P0.15 K0.15 on all',
        confidence: 0.78,
        tool: 'fertilize',
      },
      ...base.slice(1),
    ]
  }
  if (yearIndex % 5 === 0) {
    return [
      {
        id: 'quote',
        label: 'Quote',
        detail: 'Preview fertilize cost before spending',
        confidence: 0.62,
        tool: 'quote',
      },
      ...base,
    ]
  }
  return base
}

function exampleUntrainedActions(yearIndex: number, tappable: number): AgentAction[] {
  return [
    {
      id: 'fertilize',
      label: 'Fertilize',
      detail: 'N5 P5 K5 on all',
      confidence: 0.92,
      tool: 'fertilize',
    },
    {
      id: 'water',
      label: 'Water',
      detail: '50 gal/tree on all',
      confidence: 0.88,
      tool: 'water',
    },
    {
      id: 'advance',
      label: 'Advance',
      detail: '365 days',
      confidence: 0.85,
      tool: 'advance',
    },
    {
      id: 'tap',
      label: 'Tap',
      detail: tappable > 0 ? 'Start tapping mature trees' : 'No mature trees yet',
      confidence: 0.11,
      tool: 'tap',
    },
    {
      id: 'observe',
      label: 'Observe',
      detail: 'JSON snapshot of the whole farm',
      confidence: yearIndex % 4 === 0 ? 0.38 : 0.22,
      tool: 'observe',
    },
  ]
}

type ExampleStrategy = 'trained' | 'untrained'

function buildExampleRun(strategy: ExampleStrategy): RunState {
  const rows = 6
  const cols = 6
  const spacing = 5
  const fieldSize = Math.ceil(Math.max((cols - 1) * spacing, (rows - 1) * spacing) + 14)
  const yearCount = EXAMPLE_YEAR_COUNT

  const trees: ExampleTree[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      const stunted = frac(i + 43) < 0.22
      trees.push({
        row: r,
        col: c,
        startAgeYears: 0,
        growthRate: 0.75 + frac(i + 11) * 0.5,
        yieldMultiplier: 0.8 + frac(i + 29) * 0.45,
        growthPotential: stunted ? 0.34 + frac(i + 67) * 0.22 : 1,
        tapping: false,
        alive: true,
      })
    }
  }

  let revenue = 0
  let cost = 0
  let latexLb = 0
  let waterGallons = 0
  let fertilizerUnits = 0
  let prevMetrics: StateMetric[] | undefined

  const days: DayRecord[] = []
  for (let y = 0; y < yearCount; y++) {
    const year = START_YEAR + y
    const simDay = y * 365
    const rubberPrice = Number((0.88 * Math.pow(1.02, y) * (0.94 + frac(y + 3) * 0.12)).toFixed(4))
    const waterPrice = Number((0.0037 * Math.pow(1.03, y)).toFixed(4))
    const fertilizerPrice = Number((2.53 * Math.pow(1.025, y) * (0.92 + frac(y + 7) * 0.16)).toFixed(4))

    let spentThisYear = 0
    let tappable = 0
    let tappingCount = 0
    let living = 0
    let sumAge = 0
    let sumGirth = 0
    let sumHealth = 0
    let sumPanel = 0
    let sumMoisture = 0
    let sumNutrients = 0

    const treeStates: TreeState[] = []
    for (const tree of trees) {
      if (!tree.alive) continue
      const ageYears = tree.startAgeYears + y
      if (ageYears >= 34) {
        tree.alive = false
        continue
      }
      if (
        strategy === 'untrained' &&
        tree.growthPotential < 0.55 &&
        y > 22 &&
        frac(tree.row * 17 + tree.col) < 0.05 * (y - 22)
      ) {
        tree.alive = false
        continue
      }
      if (strategy === 'trained' && y > 24 && frac(tree.row * 17 + tree.col) < 0.04 * (y - 24)) {
        tree.alive = false
        continue
      }

      living++
      const maturityFrac = clamp(ageYears / MATURE_AGE_YEARS, 0, 1)
      const ageGirthCm =
        SEEDLING_GIRTH_CM +
        (MATURE_GIRTH_CM + 8 - SEEDLING_GIRTH_CM) * (1 - Math.exp(-2.2 * maturityFrac)) * tree.growthRate

      const yearsTapping = tree.tapping ? Math.max(0, ageYears - MATURE_AGE_YEARS) : 0
      const moisture =
        strategy === 'trained'
          ? clamp(0.52 + frac(y * 13 + tree.row + tree.col) * 0.28 - (tree.tapping ? 0.08 : 0), 0.15, 1)
          : clamp(
              (tree.growthPotential >= 0.9 ? 0.48 : 0.38) -
                y * 0.008 +
                frac(y * 13 + tree.row + tree.col) * 0.12,
              0.12,
              0.55,
            )
      const nutrients =
        strategy === 'trained'
          ? clamp(0.55 - y * 0.018 + frac(y * 7 + tree.col) * 0.12, 0.08, 1)
          : clamp(
              (tree.growthPotential >= 0.9 ? 0.5 : 0.38) -
                y * 0.012 +
                frac(y * 7 + tree.col) * 0.08,
              0.1,
              0.48,
            )
      const panelHealth =
        strategy === 'trained'
          ? clamp(1 - yearsTapping * 0.03, 0.45, 1)
          : clamp(0.9 - y * 0.008, 0.5, 1)
      const health =
        strategy === 'trained'
          ? clamp(0.35 * (moisture / 0.5) + 0.3 * (nutrients / 0.5) + 0.2 * panelHealth + 0.15, 0.35, 1)
          : clamp(
              0.35 * (moisture / 0.5) +
                0.3 * (nutrients / 0.5) +
                0.2 * panelHealth +
                0.05 * tree.growthPotential,
              tree.growthPotential >= 0.9 ? 0.42 : 0.22,
              tree.growthPotential >= 0.9 ? 0.68 : 0.52,
            )

      const growthGate = strategy === 'trained' ? 1 : tree.growthPotential
      const girthCm = clamp(
        SEEDLING_GIRTH_CM + (ageGirthCm - SEEDLING_GIRTH_CM) * growthGate,
        SEEDLING_GIRTH_CM,
        MAX_GIRTH_CM,
      )

      const isTappable = ageYears >= MATURE_AGE_YEARS && girthCm >= MATURE_GIRTH_CM
      if (isTappable) {
        tappable++
        if (strategy === 'trained') tree.tapping = true
      }
      if (tree.tapping && isTappable) tappingCount++

      sumAge += ageYears
      sumGirth += girthCm
      sumHealth += health
      sumPanel += panelHealth
      sumMoisture += moisture
      sumNutrients += nutrients

      const stage = treeStage(ageYears, girthCm, tree.tapping, tree.alive)
      treeStates.push({
        id: `tree-${tree.row}-${tree.col}`,
        row: tree.row,
        col: tree.col,
        x: (tree.col - (cols - 1) / 2) * spacing,
        y: (tree.row - (rows - 1) / 2) * spacing,
        girthCm: Number(girthCm.toFixed(2)),
        health: Number(health.toFixed(3)),
        stage,
        tapping: tree.tapping,
        alive: true,
      })
    }

    const avg = (n: number) => (living > 0 ? n / living : 0)
    const avgMoisture = avg(sumMoisture)
    const avgNutrients = avg(sumNutrients)

    let yearCost = 0
    if (strategy === 'trained') {
      if (avgMoisture < 0.45) {
        const gallons = 5 * living * 0.6
        yearCost += gallons * waterPrice
        waterGallons += gallons
      }
      if (avgNutrients < 0.35) {
        const units = living * 0.6
        yearCost += units * fertilizerPrice
        fertilizerUnits += units
      }
    } else {
      // Worst-case operator: burn the full annual budget on over-watering and over-fertilizing.
      yearCost = ANNUAL_BUDGET
      waterGallons += living * 12
      fertilizerUnits += living * 4.5
    }
    cost += yearCost
    spentThisYear = yearCost

    const yieldFactor = strategy === 'trained' ? avg(sumHealth) / 0.85 : avg(sumHealth) / 1.1
    const yearLatex = tappingCount * (18 + frac(y + 5) * 8) * yieldFactor
    const yearRevenue = yearLatex * rubberPrice
    latexLb += yearLatex
    revenue += yearRevenue

    const observe = {
      averages: {
        age_years: Number(avg(sumAge).toFixed(2)),
        girth_cm: Number(avg(sumGirth).toFixed(2)),
        health: Number(avg(sumHealth).toFixed(3)),
        panel_health: Number(avg(sumPanel).toFixed(3)),
        moisture: Number(avgMoisture.toFixed(3)),
        nutrients: Number(avgNutrients.toFixed(3)),
      },
      trees: { total: rows * cols, living, tappable, tapping: tappingCount },
      economics: {
        revenue: Number(revenue.toFixed(2)),
        cost: Number(cost.toFixed(2)),
        profit: Number((revenue - cost).toFixed(2)),
        latex_lb: Number(latexLb.toFixed(2)),
        water_gallons: Number(waterGallons.toFixed(1)),
        fertilizer_units: Number(fertilizerUnits.toFixed(2)),
      },
      budget: {
        annual: ANNUAL_BUDGET,
        spent_this_year: Number(spentThisYear.toFixed(2)),
        remaining_this_year: Number((ANNUAL_BUDGET - spentThisYear).toFixed(2)),
      },
      prices: {
        rubber_per_lb: rubberPrice,
        water_per_gallon: waterPrice,
        fertilizer_per_unit: fertilizerPrice,
      },
    }

    const metrics = farmMetrics(observe, prevMetrics)
    prevMetrics = metrics

    days.push({
      label: `Year ${year}`,
      trees: { field: { size: fieldSize }, trees: treeStates },
      nextAction:
        strategy === 'trained'
          ? exampleFarmActions(y, avgMoisture, avgNutrients, tappable)
          : exampleUntrainedActions(y, tappable),
      environment: {
        crop: 'Rubber plantation',
        year,
        day: simDay,
        dayOfYear: 0,
        yearsLeft: Number((yearCount - y).toFixed(2)),
        finished: y >= yearCount - 1,
        step: y,
        metrics,
      },
    })
  }

  return { field: { size: fieldSize }, days }
}

/** Sensible operator: tap mature trees, spend only when soil needs it. */
export function exampleRun(): RunState {
  return buildExampleRun('trained')
}

/** Untrained operator: never taps, maxes the budget every year — low profit. */
export function exampleUntrainedRun(): RunState {
  return buildExampleRun('untrained')
}

/** Example timeline used to seed the editor. */
export const exampleTimeline: Timeline = runToTimeline(exampleRun())
