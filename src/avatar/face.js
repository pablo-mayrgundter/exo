// Face mocap: the visitor's camera → MediaPipe Face Landmarker → the
// avatar's visor (contours of your face) and head (yaw, pitch, roll).
// Everything runs in the browser; video frames never leave the machine.
// The library and model load only when the visitor turns the camera on.

// The wasm is served from this site (scripts/copy-mediapipe.mjs); the model
// from Google's model bucket, for now.
const WASM = `${import.meta.env.BASE_URL}mediapipe`
const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

export class FaceTracker {
  constructor() {
    this.video = null
    this.landmarker = null
    this.running = false
    /** Latest landmarks (478 normalized points), or null. */
    this.landmarks = null
    /** Head rotation in radians, mirrored to read like a mirror. */
    this.head = { yaw: 0, pitch: 0, roll: 0 }
    /** Blendshape scores by name (jawOpen, mouthSmileLeft, ...). */
    this.shapes = {}
    this.lastVideoTime = -1
  }

  /** Asks for the camera and loads the model. Throws with a readable message. */
  async start() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser has no camera API.')
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false })
    this.video = document.createElement('video')
    this.video.srcObject = stream
    this.video.muted = true
    this.video.playsInline = true
    await this.video.play()
    const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision')
    const fileset = await FilesetResolver.forVisionTasks(WASM)
    const opts = (delegate) => ({
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    })
    try {
      this.landmarker = await FaceLandmarker.createFromOptions(fileset, opts('GPU'))
    } catch {
      this.landmarker = await FaceLandmarker.createFromOptions(fileset, opts('CPU'))
    }
    this.running = true
    return this.video
  }

  stop() {
    this.running = false
    this.video?.srcObject?.getTracks().forEach((t) => t.stop())
    this.landmarker?.close()
    this.landmarker = null
    this.landmarks = null
    this.video = null
  }

  /** Runs detection on the newest video frame, if there is one. */
  poll() {
    if (!this.running || !this.landmarker || this.video.readyState < 2) return
    if (this.video.currentTime === this.lastVideoTime) return
    this.lastVideoTime = this.video.currentTime
    const r = this.landmarker.detectForVideo(this.video, performance.now())
    this.landmarks = r.faceLandmarks?.[0] ?? null
    const m = r.facialTransformationMatrixes?.[0]?.data
    if (m) Object.assign(this.head, headAngles(m))
    this.shapes = {}
    for (const c of r.faceBlendshapes?.[0]?.categories ?? []) this.shapes[c.categoryName] = c.score
  }
}

/**
 * Yaw, pitch and roll from MediaPipe's column-major face transform, mirrored
 * (turn your head left and the avatar, facing you, turns its head to its
 * right, as a mirror image does).
 */
export function headAngles(m) {
  // Rotation part, row r column c at m[c * 4 + r].
  const r00 = m[0], r10 = m[1], r20 = m[2]
  const r21 = m[6], r22 = m[10]
  const yaw = Math.atan2(-r20, Math.hypot(r21, r22))
  const pitch = Math.atan2(r21, r22)
  const roll = Math.atan2(r10, r00)
  return { yaw: -yaw, pitch: -pitch, roll: -roll }
}
