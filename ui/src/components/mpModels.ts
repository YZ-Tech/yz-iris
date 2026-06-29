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

export const MODEL_ASSET_PATHS: Record<ModelId, string> = {
  'face-detector':   '/modules/yz-iris-mp/blaze_face_short_range.tflite',
  'face-landmarker': `${MP_CDN}/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
  'pose-landmarker': `${MP_CDN}/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`,
  'hand-landmarker': `${MP_CDN}/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
  // Bundled (offline) — copied into yz-iris-mp/ by the install/copy scripts.
  'object-detector': '/modules/yz-iris-mp/efficientdet_lite0.tflite',
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MPBundle = Record<string, any>

let _bundle: MPBundle | null = null
let _fileset: unknown = null

async function getBundle(): Promise<MPBundle> {
  if (_bundle) return _bundle
  _bundle = await import(/* @vite-ignore */ '/modules/yz-iris-mp/vision_bundle.mjs') as MPBundle
  return _bundle
}

async function getFileset(): Promise<unknown> {
  if (_fileset) return _fileset
  const mp = await getBundle()
  _fileset = await mp.FilesetResolver.forVisionTasks('/modules/yz-iris-mp/wasm')
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
  const path = MODEL_ASSET_PATHS[id]
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
