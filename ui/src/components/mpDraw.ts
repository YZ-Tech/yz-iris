export interface Detection {
  categories: Array<{ score: number }>
  boundingBox: { originX: number; originY: number; width: number; height: number } | null
}

export interface NormalizedLandmark {
  x: number
  y: number
  z?: number
  visibility?: number
}

export interface ObjectDetection {
  categories: Array<{ score: number; categoryName?: string }>
  boundingBox: { originX: number; originY: number; width: number; height: number } | null
}

export interface FrameResults {
  detections?: Detection[]
  faceLandmarks?: NormalizedLandmark[][]
  poseLandmarks?: NormalizedLandmark[][]
  handLandmarks?: NormalizedLandmark[][]
  objects?: ObjectDetection[]
  gaze?: string
}

const IRIS_INDICES = [468, 469, 470, 471, 472, 473, 474, 475, 476, 477]

const POSE_CONNECTIONS: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28],
  [27, 29], [29, 31], [28, 30], [30, 32],
]

const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17],
]

function drawLines(
  ctx: CanvasRenderingContext2D,
  pts: NormalizedLandmark[],
  connections: [number, number][],
  W: number,
  H: number,
) {
  for (const [a, b] of connections) {
    const pa = pts[a], pb = pts[b]
    if (!pa || !pb) continue
    ctx.beginPath()
    ctx.moveTo(pa.x * W, pa.y * H)
    ctx.lineTo(pb.x * W, pb.y * H)
    ctx.stroke()
  }
}

function drawDots(
  ctx: CanvasRenderingContext2D,
  pts: NormalizedLandmark[],
  W: number,
  H: number,
  r = 2,
) {
  for (const pt of pts) {
    ctx.beginPath()
    ctx.arc(pt.x * W, pt.y * H, r, 0, Math.PI * 2)
    ctx.fill()
  }
}

export function drawOverlay(
  results: FrameResults,
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
) {
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  const W = canvas.width
  const H = canvas.height

  // Face bounding boxes
  for (const d of results.detections ?? []) {
    const bb = d.boundingBox
    if (!bb) continue
    const score = d.categories[0]?.score ?? 0
    ctx.strokeStyle = score > 0.7 ? '#00e676' : '#ff9800'
    ctx.lineWidth = 2
    ctx.strokeRect(bb.originX, bb.originY, bb.width, bb.height)
    ctx.fillStyle = ctx.strokeStyle
    ctx.font = 'bold 11px monospace'
    ctx.fillText(`${(score * 100).toFixed(0)}%`, bb.originX + 4, bb.originY + 13)
  }

  // Face mesh dots (skip iris indices — drawn separately below)
  ctx.fillStyle = '#40c4ff'
  for (const face of results.faceLandmarks ?? []) {
    const meshOnly = face.filter((_, i) => !IRIS_INDICES.includes(i))
    drawDots(ctx, meshOnly, W, H, 1)
    // Iris in bright yellow so they stand out
    ctx.fillStyle = '#fff176'
    for (const idx of IRIS_INDICES) {
      const pt = face[idx]
      if (!pt) continue
      ctx.beginPath()
      ctx.arc(pt.x * W, pt.y * H, 2.5, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillStyle = '#40c4ff'
  }

  // Gaze label on canvas
  if (results.gaze && results.faceLandmarks && results.faceLandmarks.length > 0) {
    const color = results.gaze === 'screen' ? '#00e676' : results.gaze === 'unknown' ? '#888' : '#ff5252'
    ctx.fillStyle = color
    ctx.font = 'bold 12px monospace'
    ctx.fillText(`gaze: ${results.gaze}`, 8, H - 8)
  }

  // Pose skeleton
  ctx.strokeStyle = '#ff9800'
  ctx.lineWidth = 2
  ctx.fillStyle = '#ff9800'
  for (const pose of results.poseLandmarks ?? []) {
    drawLines(ctx, pose, POSE_CONNECTIONS, W, H)
    drawDots(ctx, pose, W, H, 3)
  }

  // Hands
  ctx.strokeStyle = '#e040fb'
  ctx.lineWidth = 2
  ctx.fillStyle = '#e040fb'
  for (const hand of results.handLandmarks ?? []) {
    drawLines(ctx, hand, HAND_CONNECTIONS, W, H)
    drawDots(ctx, hand, W, H, 3)
  }

  // Object detector boxes + labels (COCO classes), amber. boundingBox is in
  // pixel coords (same as the face detector), so draw directly.
  ctx.lineWidth = 2
  for (const o of results.objects ?? []) {
    const bb = o.boundingBox
    if (!bb) continue
    const cat = o.categories[0]
    const label = cat?.categoryName ?? 'object'
    const score = cat?.score ?? 0
    ctx.strokeStyle = '#ffd54f'
    ctx.strokeRect(bb.originX, bb.originY, bb.width, bb.height)
    const text = `${label} ${(score * 100).toFixed(0)}%`
    ctx.font = 'bold 12px monospace'
    const tw = ctx.measureText(text).width
    ctx.fillStyle = 'rgba(0,0,0,0.6)'
    ctx.fillRect(bb.originX, bb.originY - 15, tw + 8, 15)
    ctx.fillStyle = '#ffd54f'
    ctx.fillText(text, bb.originX + 4, bb.originY - 4)
  }
}
