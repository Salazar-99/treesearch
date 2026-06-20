// Dummy data for the crop-growing RL environment visualizer.
//
// The environment teaches a model to grow a crop. The *environment state* is the
// set of physical conditions (plant size, soil pH, humidity, ...). The *agent
// actions* are modifications the model applies to that environment.

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

export const cropName = 'Tomato'
export const episode = 42
export const step = 137

export const stateMetrics: StateMetric[] = [
  { key: 'plant_size', label: 'Plant size', value: 38.4, unit: 'cm', range: [0, 120], trend: 'up' },
  { key: 'soil_ph', label: 'Soil pH', value: 6.4, unit: 'pH', range: [6.0, 6.8], trend: 'flat' },
  { key: 'humidity', label: 'Humidity', value: 58, unit: '%', range: [50, 70], trend: 'down' },
  { key: 'temperature', label: 'Temperature', value: 24.1, unit: '°C', range: [18, 27], trend: 'up' },
  { key: 'water_level', label: 'Water level', value: 41, unit: '%', range: [40, 80], trend: 'down' },
  { key: 'light', label: 'Light', value: 720, unit: 'µmol', range: [400, 900], trend: 'flat' },
  { key: 'nutrients', label: 'Nutrients (N)', value: 132, unit: 'ppm', range: [100, 200], trend: 'down' },
  { key: 'co2', label: 'CO₂', value: 410, unit: 'ppm', range: [350, 500], trend: 'flat' },
]

export const nextActions: AgentAction[] = [
  { id: 'a1', label: 'Increase irrigation', detail: 'Water level +15%', confidence: 0.82 },
  { id: 'a2', label: 'Add nitrogen', detail: 'Nutrients +25 ppm', confidence: 0.64 },
  { id: 'a3', label: 'Lower temperature', detail: 'Target 22 °C', confidence: 0.41 },
  { id: 'a4', label: 'Hold', detail: 'No change this step', confidence: 0.18 },
]
