import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import TreeScene, { type PlaybackClock } from './TreeScene'
import {
  compileTimeline,
  dayAt,
  exampleRun,
  exampleUntrainedRun,
  parseRunState,
  runToTimeline,
  wateringFlagsFromRun,
  type RunState,
  type StateMetric,
} from './sceneState'

function trendGlyph(trend: StateMetric['trend']) {
  return trend === 'up' ? '▲' : trend === 'down' ? '▼' : '—'
}

function inRange(m: StateMetric) {
  return m.value >= m.range[0] && m.value <= m.range[1]
}

type RunSource = 'trained' | 'untrained'

const SPEEDS = [0.5, 1, 2, 4]

function App() {
  const [trainedRun, setTrainedRun] = useState<RunState>(exampleRun)
  const [untrainedRun, setUntrainedRun] = useState<RunState>(exampleUntrainedRun)
  const [activeSource, setActiveSource] = useState<RunSource>('trained')
  const [errors, setErrors] = useState<Record<RunSource, string | null>>({
    trained: null,
    untrained: null,
  })
  const [fileNames, setFileNames] = useState<Record<RunSource, string | null>>({
    trained: null,
    untrained: null,
  })

  const run = activeSource === 'trained' ? trainedRun : untrainedRun
  const timeline = useMemo(() => runToTimeline(run), [run])
  const wateringFlags = useMemo(() => wateringFlagsFromRun(run), [run])

  const clock = useRef<PlaybackClock>({ t: 0, playing: true, speed: 1, seek: null })
  const trainedInputRef = useRef<HTMLInputElement>(null)
  const untrainedInputRef = useRef<HTMLInputElement>(null)
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [progress, setProgress] = useState(0)

  const compiled = useMemo(() => compileTimeline(timeline), [timeline])
  const maxT = Math.max(0, compiled.frameCount - 1)
  const animatable = maxT > 0

  const dayIndex = Math.min(maxT, Math.max(0, Math.round(progress)))
  const currentDay = dayAt(run, dayIndex)
  const frameLabel = currentDay?.label ?? compiled.labels[dayIndex] ?? `Year ${dayIndex}`
  const farmName = currentDay?.environment.crop ?? 'Rubber plantation'
  const year = currentDay?.environment.year
  const simDay = currentDay?.environment.day ?? currentDay?.environment.step ?? dayIndex
  const yearsLeft = currentDay?.environment.yearsLeft
  const profit =
    currentDay?.environment.metrics.find((m) => m.key === 'profit')?.value ??
    currentDay?.environment.metrics.find((m) => m.key === 'revenue')?.value
  const stateMetrics = currentDay?.environment.metrics ?? []
  const nextActions = currentDay?.nextAction ?? []

  const resetPlayback = useCallback(() => {
    clock.current.t = 0
    clock.current.seek = null
    setProgress(0)
  }, [])

  useEffect(() => {
    resetPlayback()
  }, [activeSource, resetPlayback])

  const handleProgress = useCallback((t: number) => setProgress(t), [])

  function openUpload(source: RunSource) {
    if (source === 'trained') trainedInputRef.current?.click()
    else untrainedInputRef.current?.click()
  }

  function handleUpload(source: RunSource, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      const { run: parsed, error: parseError } = parseRunState(String(reader.result ?? ''))
      if (parsed) {
        if (source === 'trained') setTrainedRun(parsed)
        else setUntrainedRun(parsed)
        setErrors((prev) => ({ ...prev, [source]: null }))
        setFileNames((prev) => ({ ...prev, [source]: file.name }))
        if (source === activeSource) resetPlayback()
      } else {
        setErrors((prev) => ({ ...prev, [source]: parseError }))
      }
    }
    reader.onerror = () => {
      setErrors((prev) => ({ ...prev, [source]: 'Could not read the selected file.' }))
    }
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

  const activeError = errors[activeSource]

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-left">
          <h1>Treesearch</h1>
        </div>
        <div className="run-info">
          <span>{farmName}</span>
          {year !== undefined ? <span>Year {year}</span> : null}
          <span>Day {simDay}</span>
          {yearsLeft !== undefined ? <span>{yearsLeft}y left</span> : null}
          {profit !== undefined ? <span>Profit ${profit.toFixed(0)}</span> : null}
        </div>
      </header>

      <main className="layout">
        <section className="panel visualization">
          <div className="visualization-canvas" aria-label="3D Treesearch scene">
            <TreeScene
              timeline={timeline}
              clock={clock}
              onProgress={handleProgress}
              wateringFlags={wateringFlags}
            />
          </div>

          <div className="run-source" role="group" aria-label="Select run to visualize">
            <span className="run-source-label">Visualizing</span>
            <div className="source-select">
              {(['trained', 'untrained'] as const).map((source) => (
                <button
                  key={source}
                  type="button"
                  className={`source-button ${activeSource === source ? 'active' : ''}`}
                  onClick={() => setActiveSource(source)}
                  aria-pressed={activeSource === source}
                >
                  {source === 'trained' ? 'Trained' : 'Untrained'}
                </button>
              ))}
            </div>
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
              ref={trainedInputRef}
              type="file"
              accept=".json,application/json"
              onChange={(e) => handleUpload('trained', e)}
              hidden
            />
            <input
              ref={untrainedInputRef}
              type="file"
              accept=".json,application/json"
              onChange={(e) => handleUpload('untrained', e)}
              hidden
            />
            <div className="state-upload-row">
              {(['trained', 'untrained'] as const).map((source) => (
                <div key={source} className="state-upload-slot">
                  <button
                    className="state-button"
                    type="button"
                    onClick={() => openUpload(source)}
                  >
                    Upload {source === 'trained' ? 'trained' : 'untrained'}
                  </button>
                  <span className="state-file-name">
                    {fileNames[source] ?? (source === 'trained' ? 'trained example' : 'untrained example')}
                  </span>
                  {errors[source] ? (
                    <span className="state-error">{errors[source]}</span>
                  ) : null}
                </div>
              ))}
            </div>
            {!activeError ? (
              <span className="state-hint">
                {compiled.frameCount} year{compiled.frameCount === 1 ? '' : 's'},{' '}
                {compiled.tracks.length} tree{compiled.tracks.length === 1 ? '' : 's'}
              </span>
            ) : (
              <span className="state-error">{activeError}</span>
            )}
          </div>
        </section>

        <aside className="panel actions">
          <h2 className="panel-title">Agent tools</h2>
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
          <h2 className="panel-title">Farm state</h2>
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
