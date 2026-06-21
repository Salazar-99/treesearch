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
  /** The environment modification the model proposes. */
  label: string
  detail: string
  /** Model confidence in this action, 0-1. */
  confidence: number
}

/** Physical / run metadata shown in the header and metrics panel. */
export interface EnvironmentState {
  crop?: string
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
  /** Field position, left→right. */
  x: number
  /** Field position, front→back. */
  y: number
  /** Overall scale. 1 ≈ a mature tree. Default 1. */
  size?: number
  /** Health/lushness in [0,1]: 1 = full green canopy, 0 = sparse & yellowed. Default 1. */
  health?: number
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

export function resolveTrees(state: SceneState): ResolvedTree[] {
  return state.trees.map((t, i) => {
    const id = t.id ?? `tree-${i}`
    return {
      id,
      x: t.x,
      y: t.y,
      size: clamp(t.size ?? 1, 0.2, 4),
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

const TRENDS = new Set<Trend>(['up', 'down', 'flat'])

/** Default metrics/actions used when legacy timeline JSON omits them. */
export const defaultEnvironment = (step = 0): EnvironmentState => ({
  crop: 'Rubber Tree',
  episode: 42,
  step,
  metrics: defaultMetrics(step),
})

export function defaultMetrics(step = 0): StateMetric[] {
  const wobble = (base: number, amp: number) =>
    Number((base + Math.sin(step * 0.17) * amp).toFixed(1))
  return [
    { key: 'plant_size', label: 'Plant size', value: wobble(38.4, 4), unit: 'cm', range: [0, 120], trend: 'up' },
    { key: 'soil_ph', label: 'Soil pH', value: 6.4, unit: 'pH', range: [6.0, 6.8], trend: 'flat' },
    { key: 'humidity', label: 'Humidity', value: wobble(58, 6), unit: '%', range: [50, 70], trend: 'down' },
    { key: 'temperature', label: 'Temperature', value: wobble(24.1, 2), unit: '°C', range: [18, 27], trend: 'up' },
    { key: 'water_level', label: 'Water level', value: wobble(41, 8), unit: '%', range: [40, 80], trend: 'down' },
    { key: 'light', label: 'Light', value: 720, unit: 'µmol', range: [400, 900], trend: 'flat' },
    { key: 'nutrients', label: 'Nutrients (N)', value: wobble(132, 12), unit: 'ppm', range: [100, 200], trend: 'down' },
    { key: 'co2', label: 'CO₂', value: 410, unit: 'ppm', range: [350, 500], trend: 'flat' },
  ]
}

export function defaultNextActions(step = 0): AgentAction[] {
  const actions: AgentAction[] = [
    { id: 'a1', label: 'Increase irrigation', detail: 'Water level +15%', confidence: 0.82 },
    { id: 'a2', label: 'Add nitrogen', detail: 'Nutrients +25 ppm', confidence: 0.64 },
    { id: 'a3', label: 'Lower temperature', detail: 'Target 22 °C', confidence: 0.41 },
    { id: 'a4', label: 'Hold', detail: 'No change this step', confidence: 0.18 },
  ]
  if (step % 7 === 3) {
    return [
      { id: 'a1', label: 'Prune canopy', detail: 'Remove lower branches', confidence: 0.71 },
      ...actions.slice(1),
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
    for (const k of ['size', 'health'] as const) {
      if (t[k] !== undefined && (typeof t[k] !== 'number' || !Number.isFinite(t[k] as number))) {
        return { value: null, error: `${where}[${i}].${k} must be a number.` }
      }
    }
    if (t.id !== undefined && typeof t.id !== 'string') {
      return { value: null, error: `${where}[${i}].id must be a string.` }
    }
    trees.push({
      id: t.id as string | undefined,
      x: t.x,
      y: t.y,
      size: t.size as number | undefined,
      health: t.health as number | undefined,
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
  return {
    value: {
      id: a.id,
      label: a.label,
      detail: a.detail,
      confidence: clamp(a.confidence, 0, 1),
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
  for (const k of ['episode', 'step'] as const) {
    if (e[k] !== undefined && (typeof e[k] !== 'number' || !Number.isFinite(e[k] as number))) {
      return { value: null, error: `${where}.${k} must be a number.` }
    }
  }
  return {
    value: {
      crop: e.crop as string | undefined,
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

/** Number of days in the bundled example / test run (one year). */
export const EXAMPLE_DAY_COUNT = 365

/** Example run used to seed the editor (365 days with trees, actions, and metrics). */
export function exampleRun(): RunState {
  const cols = 4
  const rows = 8
  const spacing = 5
  const fieldSize = Math.ceil(Math.max((cols - 1) * spacing, (rows - 1) * spacing) + 14)
  const dayCount = EXAMPLE_DAY_COUNT

  const cells = Array.from({ length: cols * rows }, (_, i) => ({
    finalSize: Number((0.7 + frac(i + 1) * 0.8).toFixed(2)),
    germinate: frac(i + 17) * 0.35,
    healthDip: frac(i + 53) < 0.18 ? 0.35 + frac(i + 71) * 0.3 : 0,
  }))

  const days: DayRecord[] = []
  for (let d = 0; d < dayCount; d++) {
    const progress = d / Math.max(1, dayCount - 1)
    const trees: TreeState[] = []
    let i = 0
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = cells[i]
        i++
        if (progress < cell.germinate) continue
        const span = 1 - cell.germinate
        const local = span <= 0 ? 1 : clamp((progress - cell.germinate) / span, 0, 1)
        const size = Number((cell.finalSize * (0.12 + 0.88 * smoothstep(local))).toFixed(3))
        const health =
          cell.healthDip > 0
            ? Number(clamp(1 - cell.healthDip * smoothstep(clamp((progress - 0.6) / 0.4, 0, 1)), 0, 1).toFixed(3))
            : 1
        trees.push({
          id: `tree-${r}-${c}`,
          x: (c - (cols - 1) / 2) * spacing,
          y: (r - (rows - 1) / 2) * spacing,
          size,
          health,
        })
      }
    }

    const water = clamp(35 + progress * 30 + frac(d + 2) * 8, 0, 100)
    const nutrients = clamp(110 + progress * 40, 0, 220)
    const plantSize = Number((12 + progress * 48 + trees.length * 0.4).toFixed(1))

    days.push({
      label: `Day ${d}`,
      trees: { field: { size: fieldSize }, trees },
      nextAction:
        water < 45
          ? [
              { id: 'a1', label: 'Increase irrigation', detail: 'Water level +15%', confidence: 0.86 },
              { id: 'a2', label: 'Add nitrogen', detail: 'Nutrients +25 ppm', confidence: 0.58 },
              { id: 'a3', label: 'Hold', detail: 'No change this step', confidence: 0.22 },
            ]
          : d % 7 === 3
            ? [
                { id: 'a1', label: 'Prune canopy', detail: 'Remove lower branches', confidence: 0.74 },
                { id: 'a2', label: 'Increase irrigation', detail: 'Water level +10%', confidence: 0.52 },
                { id: 'a3', label: 'Hold', detail: 'No change this step', confidence: 0.19 },
              ]
            : defaultNextActions(d),
      environment: {
        crop: 'Rubber Tree',
        episode: 42,
        step: d,
        metrics: [
          { key: 'plant_size', label: 'Plant size', value: plantSize, unit: 'cm', range: [0, 120], trend: 'up' },
          { key: 'soil_ph', label: 'Soil pH', value: 6.4, unit: 'pH', range: [6.0, 6.8], trend: 'flat' },
          { key: 'humidity', label: 'Humidity', value: Number((55 + frac(d) * 12).toFixed(0)), unit: '%', range: [50, 70], trend: d % 5 === 0 ? 'down' : 'flat' },
          { key: 'temperature', label: 'Temperature', value: Number((22 + frac(d + 11) * 4).toFixed(1)), unit: '°C', range: [18, 27], trend: 'up' },
          { key: 'water_level', label: 'Water level', value: Number(water.toFixed(0)), unit: '%', range: [40, 80], trend: water < 45 ? 'down' : 'up' },
          { key: 'light', label: 'Light', value: 720, unit: 'µmol', range: [400, 900], trend: 'flat' },
          { key: 'nutrients', label: 'Nutrients (N)', value: Number(nutrients.toFixed(0)), unit: 'ppm', range: [100, 200], trend: nutrients < 120 ? 'down' : 'up' },
          { key: 'co2', label: 'CO₂', value: 410, unit: 'ppm', range: [350, 500], trend: 'flat' },
        ],
      },
    })
  }

  return { field: { size: fieldSize }, days }
}

/** Example timeline used to seed the editor. */
export const exampleTimeline: Timeline = runToTimeline(exampleRun())
