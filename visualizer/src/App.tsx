import { useCallback, useMemo, useRef, useState } from 'react'
import './App.css'
import TreeScene, { type PlaybackClock } from './TreeScene'
import {
  compileTimeline,
  dayAt,
  exampleRun,
  parseRunState,
  runToTimeline,
  type RunState,
  type StateMetric,
} from './sceneState'

function trendGlyph(trend: StateMetric['trend']) {
  return trend === 'up' ? '▲' : trend === 'down' ? '▼' : '—'
}

function inRange(m: StateMetric) {
  return m.value >= m.range[0] && m.value <= m.range[1]
}

const SPEEDS = [0.5, 1, 2, 4]
const initialRun = exampleRun()

function App() {
  const [run, setRun] = useState<RunState>(initialRun)
  const [error, setError] = useState<string | null>(null)

  const timeline = useMemo(() => runToTimeline(run), [run])

  // Playback state mirrored into the render-loop clock (see TreeScene).
  const clock = useRef<PlaybackClock>({ t: 0, playing: true, speed: 1, seek: null })
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [progress, setProgress] = useState(0)

  const compiled = useMemo(() => compileTimeline(timeline), [timeline])
  const maxT = Math.max(0, compiled.frameCount - 1)
  const animatable = maxT > 0

  const dayIndex = Math.min(maxT, Math.max(0, Math.round(progress)))
  const currentDay = dayAt(run, dayIndex)
  const frameLabel = currentDay?.label ?? compiled.labels[dayIndex] ?? `Day ${dayIndex}`
  const cropName = currentDay?.environment.crop ?? '—'
  const episode = currentDay?.environment.episode ?? '—'
  const step = currentDay?.environment.step ?? dayIndex
  const stateMetrics = currentDay?.environment.metrics ?? []
  const nextActions = currentDay?.nextAction ?? []

  // The render loop pushes the playhead here so the scrubber tracks playback.
  const handleProgress = useCallback((t: number) => setProgress(t), [])

  function openStateUpload() {
    fileInputRef.current?.click()
  }

  function handleStateUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      const { run: parsed, error: parseError } = parseRunState(String(reader.result ?? ''))
      if (parsed) {
        setRun(parsed)
        setError(null)
        clock.current.t = 0
        clock.current.seek = null
        setProgress(0)
      } else {
        setError(parseError)
      }
    }
    reader.onerror = () => setError('Could not read the selected file.')
    reader.readAsText(file)
  }

  function togglePlay() {
    const next = !playing
    setPlaying(next)
    clock.current.playing = next
  }

  function changeSpeed(s: number) {
    setSpeed(s)
    clock.current.speed = s
  }

  function scrub(value: number) {
    const day = Math.min(maxT, Math.max(0, Math.round(value)))
    const timeOfDay = clock.current.t - Math.floor(clock.current.t)
    clock.current.t = Math.min(maxT, day + timeOfDay)
    clock.current.seek = null
    setProgress(day)
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Treesearch</h1>
        <div className="run-info">
          <span>{cropName}</span>
          <span>Episode {episode}</span>
          <span>Step {step}</span>
        </div>
      </header>

      <main className="layout">
        <section className="panel visualization">
          <div className="visualization-canvas" aria-label="3D Treesearch scene">
            <TreeScene timeline={timeline} clock={clock} onProgress={handleProgress} />
          </div>

          <div className="playback" role="group" aria-label="Timeline playback">
            <button
              className="playback-button"
              onClick={togglePlay}
              disabled={!animatable}
              aria-label={playing ? 'Pause' : 'Play'}
            >
              {playing ? '❚❚' : '►'}
            </button>
            <input
              className="playback-scrubber"
              type="range"
              min={0}
              max={maxT}
              step={1}
              value={dayIndex}
              disabled={!animatable}
              onChange={(e) => scrub(Number(e.target.value))}
              aria-label="Timeline position"
            />
            <span className="playback-label">
              {frameLabel} · {dayIndex + 1}/{compiled.frameCount}
            </span>
            <div className="playback-speeds">
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  className={`speed-button ${speed === s ? 'active' : ''}`}
                  onClick={() => changeSpeed(s)}
                  disabled={!animatable}
                >
                  {s}×
                </button>
              ))}
            </div>
          </div>

          <div className="state-upload">
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={handleStateUpload}
              hidden
            />
            <button className="state-button" type="button" onClick={openStateUpload}>
              Upload state.json
            </button>
            {error ? (
              <span className="state-error">{error}</span>
            ) : (
              <span className="state-hint">
                {compiled.frameCount} day{compiled.frameCount === 1 ? '' : 's'},{' '}
                {compiled.tracks.length} tree{compiled.tracks.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
        </section>

        <aside className="panel actions">
          <h2 className="panel-title">Model next actions</h2>
          <ul className="action-list">
            {nextActions.map((a) => (
              <li key={a.id} className="action">
                <div className="action-head">
                  <span className="action-label">{a.label}</span>
                  <span className="action-confidence">{Math.round(a.confidence * 100)}%</span>
                </div>
                <div className="action-detail">{a.detail}</div>
                <div className="confidence-bar">
                  <div className="confidence-fill" style={{ width: `${a.confidence * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </aside>

        <section className="panel metrics">
          <h2 className="panel-title">State metrics</h2>
          <div className="metric-grid">
            {stateMetrics.map((m) => (
              <div key={m.key} className={`metric ${inRange(m) ? '' : 'out-of-range'}`}>
                <div className="metric-label">{m.label}</div>
                <div className="metric-value">
                  {m.value}
                  <span className="metric-unit">{m.unit}</span>
                  <span className={`metric-trend trend-${m.trend}`}>{trendGlyph(m.trend)}</span>
                </div>
                <div className="metric-range">
                  range {m.range[0]}–{m.range[1]} {m.unit}
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
