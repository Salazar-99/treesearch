// Re-export run-state types and defaults for backward compatibility.
export type {
  Trend,
  TreeStage,
  FarmTool,
  StateMetric,
  AgentAction,
  EnvironmentState,
} from './sceneState'

export {
  defaultEnvironment,
  defaultMetrics,
  defaultNextActions,
  farmMetrics,
} from './sceneState'
