// Re-export run-state types and defaults for backward compatibility.
export type {
  Trend,
  StateMetric,
  AgentAction,
  EnvironmentState,
} from './sceneState'

export {
  defaultEnvironment,
  defaultMetrics,
  defaultNextActions,
} from './sceneState'
