// Mocap: the visitor's camera → MediaPipe's Face Landmarker → the avatar's
// visor (contours of your face) and head (yaw, pitch, roll); its Pose
// Landmarker → where your arms point; and its Hand Landmarker → your hands,
// finger by finger (thumbs up, peace, OK, fists).
// Everything runs in the browser; video frames never leave the machine.
// The library and model load only when the visitor turns the camera on.

// The wasm is served from this site (scripts/copy-mediapipe.mjs); the model
// from Google's model bucket, for now.
const WASM = `${import.meta.env.BASE_URL}mediapipe`
const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
const POSE_MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'
const HAND_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'
// Pose landmarks: shoulders, elbows and wrists, left (the person's) first.
const ARM = { L: [11, 13, 15], R: [12, 14, 16] }

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
    /**
     * Where each arm points, shoulder to wrist, as a unit vector in avatar
     * space (+x the avatar's left, +y up, +z forward), or null when that
     * arm isn't in view.
     */
    this.arms = { L: null, R: null }
    this.pose = null
    /**
     * Each hand's 21 landmarks relative to its wrist, in avatar space
     * (metres; +x the avatar's left, +y up, +z forward), as 63 numbers, or
     * null when that hand isn't in view.
     */
    this.hands = { L: null, R: null }
    this.handLandmarker = null
    this.wristsImg = { L: null, R: null } // where the pose saw the wrists, image coords
    this.lastVideoTime = -1
    this.frames = 0
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
    // Arms are a bonus: without the pose model the face still works.
    try {
      const { PoseLandmarker } = await import('@mediapipe/tasks-vision')
      this.pose = await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: POSE_MODEL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numPoses: 1,
      })
    } catch (err) {
      console.warn('No arm tracking:', err)
    }
    try {
      const { HandLandmarker } = await import('@mediapipe/tasks-vision')
      this.handLandmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: HAND_MODEL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numHands: 2,
      })
    } catch (err) {
      console.warn('No hand tracking:', err)
    }
    this.running = true
    return this.video
  }

  stop() {
    this.running = false
    this.video?.srcObject?.getTracks().forEach((t) => t.stop())
    this.landmarker?.close()
    this.landmarker = null
    this.pose?.close()
    this.pose = null
    this.handLandmarker?.close()
    this.handLandmarker = null
    this.arms = { L: null, R: null }
    this.hands = { L: null, R: null }
    this.landmarks = null
    this.video = null
  }

  /** Runs detection on the newest video frame, if there is one. */
  poll() {
    if (!this.running || !this.landmarker || this.video.readyState < 2) return
    if (this.video.currentTime === this.lastVideoTime) return
    this.lastVideoTime = this.video.currentTime
    // Face, pose and hands take turns, so each costs a third of the frames.
    const turn = this.frames++ % 3
    if (turn === 1 && this.pose) {
      const p = this.pose.detectForVideo(this.video, performance.now())
      const w = p.worldLandmarks?.[0], img = p.landmarks?.[0]
      for (const side of ['L', 'R']) {
        const [sh, el, wr] = ARM[side]
        const seen = img && img[sh].visibility > 0.5 && img[wr].visibility > 0.5
        // With the elbow seen too, the upper arm and the forearm each; else the whole arm.
        const elbow = seen && img[el].visibility > 0.5
        this.arms[side] = !seen || !w ? null
          : elbow ? [...armDirection(w[sh], w[el]), ...armDirection(w[el], w[wr])] : armDirection(w[sh], w[wr])
        this.wristsImg[side] = img && img[wr].visibility > 0.3 ? img[wr] : null
      }
      return
    }
    if (turn === 2 && this.handLandmarker) {
      const h = this.handLandmarker.detectForVideo(this.video, performance.now())
      const found = { L: null, R: null }
      ;(h.landmarks ?? []).forEach((img, i) => {
        const side = whichHand(img[0], this.wristsImg, h.handedness?.[i]?.[0]?.categoryName)
        if (side && !found[side]) found[side] = handPoints(h.worldLandmarks[i])
      })
      this.hands = found
      return
    }
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

/**
 * A shoulder-to-wrist direction from MediaPipe's world landmarks (metres,
 * x toward the person's left as the camera sees them, y down, z away from
 * the camera) to avatar space, unit length. Arms map straight across, not
 * mirrored: you usually see your avatar from behind, so your left arm
 * raises the arm on your left of the screen.
 */
export function armDirection(shoulder, wrist) {
  const x = wrist.x - shoulder.x, y = -(wrist.y - shoulder.y), z = -(wrist.z - shoulder.z)
  const n = Math.hypot(x, y, z) || 1
  return [x / n, y / n, z / n]
}

/**
 * Which of the person's hands a detection is: the one whose wrist the pose
 * saw nearest, else MediaPipe's handedness label. Older MediaPipe docs say
 * the label assumes a mirrored (selfie) image; tasks-vision 1.2 on our
 * unmirrored video labels the person's own hands (checked on stills of
 * raised hands, a peace sign and fists: the right hand reads "Right").
 */
export function whichHand(wrist, poseWrists, label) {
  const d = (p) => (p ? Math.hypot(p.x - wrist.x, p.y - wrist.y) : Infinity)
  const dl = d(poseWrists.L), dr = d(poseWrists.R)
  if (Math.min(dl, dr) < 0.25) return dl < dr ? 'L' : 'R'
  if (label === 'Left') return 'L'
  if (label === 'Right') return 'R'
  return null
}

/** A hand's world landmarks, relative to its wrist, in avatar space. */
export function handPoints(world) {
  const out = new Array(63)
  const w = world[0]
  world.forEach((p, i) => {
    out[i * 3] = p.x - w.x
    out[i * 3 + 1] = -(p.y - w.y)
    out[i * 3 + 2] = -(p.z - w.z)
  })
  return out
}
