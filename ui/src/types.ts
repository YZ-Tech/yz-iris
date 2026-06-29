export interface Camera {
  index: number
  name: string
}

export interface CamerasResponse {
  cameras: Camera[]
  selected_index: number
  selected_label: string
}

export interface SourceInfo {
  id: string
  label: string
  running: boolean
  mediapipe_available?: boolean
}

export interface IrisState {
  running: boolean
  browser_connected: boolean
  mobile_connected: boolean
  any_running: boolean
  present: boolean
  position: 'left' | 'center' | 'right' | 'unknown'
  distance: 'near' | 'medium' | 'far' | 'unknown'
  gaze: 'screen' | 'away' | 'unknown'
  last_updated: number
  selected_index: number
  selected_label: string
  sources: SourceInfo[]
}

export interface YoloeStatus {
  available: boolean
  installing: boolean
  install_error: string | null
  loaded: string[]
  model_prompt: string
  model_prompt_free: string
}

export interface DetectedObject {
  label: string
  conf: number
  box: [number, number, number, number]
}

export interface ScanResult {
  ok: boolean
  available: boolean
  text: string
  objects: DetectedObject[]
  count: number
  frame_path?: string
  error?: string
}

export interface LookResult {
  ok: boolean
  available: boolean
  found: boolean
  text: string
  objects: DetectedObject[]
  frame_path?: string
  error?: string
}

export interface PresenceEvent {
  present: boolean
  position: string
  distance: string
}

export interface GazeEvent {
  target: string
}
