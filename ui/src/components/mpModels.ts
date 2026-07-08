export type ModelId =
  | 'face-detector'
  | 'face-landmarker'
  | 'pose-landmarker'
  | 'hand-landmarker'
  | 'object-detector'

export interface ModelDef {
  id: ModelId
  label: string
  desc: string
  size: string
  color: string
}

export const MODELS: ModelDef[] = [
  { id: 'face-detector',   label: 'Face Detector',   desc: 'Presence + bounding box',    size: '224 KB', color: '#00e676' },
  { id: 'face-landmarker', label: 'Face Landmarker', desc: '478 landmarks + iris (gaze)', size: '3.4 MB', color: '#40c4ff' },
  { id: 'pose-landmarker', label: 'Pose Landmarker', desc: '33 body keypoints',           size: '4.7 MB', color: '#ff9800' },
  { id: 'hand-landmarker', label: 'Hand Landmarker', desc: 'Hand + finger landmarks',     size: '8.3 MB', color: '#e040fb' },
  { id: 'object-detector', label: 'Object Detector', desc: '80 common objects (COCO), live boxes', size: '13.8 MB', color: '#ffd54f' },
]

const MP_CDN = 'https://storage.googleapis.com/mediapipe-models'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MPBundle = Record<string, any>

let _bundle: MPBundle | null = null
let _fileset: unknown = null

// Where the bundled MediaPipe assets (wasm + local .tflite) are served FROM.
// Standalone SPA: '' — the satellite's own static mount serves
// /modules/yz-iris-mp/*. JarvYZ-embedded: '/api/iris' — core's straight-strip
// proxy to that same satellite mount. Core deliberately does NOT bake the
// 46 MB of assets into its wheel (backend pyproject package-data exclusion),
// so same-origin core URLs 404 on installed builds — found live in the UE
// CEF panel 2026-07-08. IrisPage sets this per mount mode.
let _assetBase = ''

export function setMpAssetBase(base: string): void {
  const next = base.replace(/\/$/, '')
  if (next !== _assetBase) {
    _assetBase = next
    // The base only flips between mount modes; drop the cached bundle +
    // fileset so they reload from the right origin.
    _bundle = null
    _fileset = null
  }
}

const mpAsset = (file: string) => `${_assetBase}/modules/yz-iris-mp/${file}`

function modelAssetPath(id: ModelId): string {
  switch (id) {
    // Bundled (offline) — copied into yz-iris-mp/ by the install/copy scripts.
    case 'face-detector':
      return mpAsset('blaze_face_short_range.tflite')
    case 'object-detector':
      return mpAsset('efficientdet_lite0.tflite')
    case 'face-landmarker':
      return `${MP_CDN}/face_landmarker/face_landmarker/float16/1/face_landmarker.task`
    case 'pose-landmarker':
      return `${MP_CDN}/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`
    case 'hand-landmarker':
      return `${MP_CDN}/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`
  }
}

async function getBundle(): Promise<MPBundle> {
  if (_bundle) return _bundle
  _bundle = await import(/* @vite-ignore */ mpAsset('vision_bundle.mjs')) as MPBundle
  return _bundle
}

async function getFileset(): Promise<unknown> {
  if (_fileset) return _fileset
  const mp = await getBundle()
  _fileset = await mp.FilesetResolver.forVisionTasks(mpAsset('wasm'))
  return _fileset
}

export interface AnyDetector {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  detectForVideo(video: HTMLVideoElement, ts: number): any
  close(): void
}

export async function loadModel(id: ModelId): Promise<AnyDetector> {
  const mp = await getBundle()
  const fileset = await getFileset()
  const path = modelAssetPath(id)
  switch (id) {
    case 'face-detector':
      return mp.FaceDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: path, delegate: 'GPU' },
        runningMode: 'VIDEO',
        minDetectionConfidence: 0.4,
      })
    case 'face-landmarker':
      return mp.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: path, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numFaces: 4,
        minFaceDetectionConfidence: 0.4,
        minFacePresenceConfidence: 0.4,
        minTrackingConfidence: 0.4,
        outputFaceBlendshapes: false,
      })
    case 'pose-landmarker':
      return mp.PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: path, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numPoses: 2,
        minPoseDetectionConfidence: 0.4,
        minPosePresenceConfidence: 0.4,
        minTrackingConfidence: 0.4,
      })
    case 'hand-landmarker':
      return mp.HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: path, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numHands: 4,
        minHandDetectionConfidence: 0.4,
        minHandPresenceConfidence: 0.4,
        minTrackingConfidence: 0.4,
      })
    case 'object-detector':
      return mp.ObjectDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: path, delegate: 'GPU' },
        runningMode: 'VIDEO',
        scoreThreshold: 0.4,
        maxResults: 10,
      })
  }
}
