export type GazeTarget = 'screen' | 'left' | 'right' | 'away' | 'unknown'

// Face Landmarker landmark indices
const L_EYE_OUTER = 33   // person's left eye, outer corner (high x in image)
const L_EYE_INNER = 133  // person's left eye, inner corner (near nose)
const R_EYE_OUTER = 362  // person's right eye, outer corner (low x in image)
const R_EYE_INNER = 263  // person's right eye, inner corner (near nose)
const NOSE_TIP = 4
const L_IRIS = 468
const R_IRIS = 473

interface Pt { x: number; y: number }

export function estimateGaze(landmarks: Pt[]): GazeTarget {
  const lOuter = landmarks[L_EYE_OUTER]
  const lInner = landmarks[L_EYE_INNER]
  const rOuter = landmarks[R_EYE_OUTER]
  const rInner = landmarks[R_EYE_INNER]
  const nose = landmarks[NOSE_TIP]
  const lIris = landmarks[L_IRIS]
  const rIris = landmarks[R_IRIS]

  if (!lOuter || !rOuter || !nose || !lInner || !rInner) return 'unknown'

  // Head pose: if nose is far from the midpoint between eye corners, face is turned
  const eyeMidX = (lOuter.x + rOuter.x) / 2
  const eyeSpan = Math.abs(lOuter.x - rOuter.x)
  const noseDev = eyeSpan > 0.01 ? Math.abs(nose.x - eyeMidX) / eyeSpan : 0
  if (noseDev > 0.2) return 'away'

  // Face is roughly frontal — use iris position for fine gaze
  if (!lIris || !rIris) return 'screen'

  // Left eye: outer (33) has higher x, inner (133) has lower x
  // Ratio 0 = iris at inner, 1 = iris at outer
  const lWidth = lOuter.x - lInner.x
  const lRatio = lWidth > 0.005 ? (lIris.x - lInner.x) / lWidth : 0.5

  // Right eye: outer (362) has lower x, inner (263) has higher x
  // Ratio 0 = iris at outer, 1 = iris at inner
  const rWidth = rInner.x - rOuter.x
  const rRatio = rWidth > 0.005 ? (rIris.x - rOuter.x) / rWidth : 0.5

  // Both eyes agree: < 0.35 = person looking to their right, > 0.65 = their left
  const avg = (lRatio + rRatio) / 2
  if (avg < 0.35) return 'right'
  if (avg > 0.65) return 'left'
  return 'screen'
}

// Map fine-grained gaze to the three-state schema the backend IrisState uses
export function gazeToBackend(g: GazeTarget): 'screen' | 'away' | 'unknown' {
  if (g === 'screen') return 'screen'
  if (g === 'unknown') return 'unknown'
  return 'away'
}
