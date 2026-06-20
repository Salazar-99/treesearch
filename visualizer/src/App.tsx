import './App.css'
import {
  cropName,
  episode,
  step,
  stateMetrics,
  nextActions,
  type StateMetric,
} from './data'

function trendGlyph(trend: StateMetric['trend']) {
  return trend === 'up' ? '▲' : trend === 'down' ? '▼' : '—'
}

function inRange(m: StateMetric) {
  return m.value >= m.range[0] && m.value <= m.range[1]
}

function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1>Crop RL Environment</h1>
        <div className="run-info">
          <span>{cropName}</span>
          <span>Episode {episode}</span>
          <span>Step {step}</span>
        </div>
      </header>

      <main className="layout">
        <section className="panel visualization">
          <h2 className="panel-title">Visualization of current state</h2>
          <div className="visualization-canvas" aria-label="visualization placeholder" />
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
