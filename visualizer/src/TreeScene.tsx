import { Canvas, useFrame, useThree } from '@react-three/fiber'
import {
  OrbitControls,
  Sky,
  Cloud,
  Clouds,
  Environment,
  Lightformer,
  Stars,
  useGLTF,
} from '@react-three/drei'
import { Suspense, useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import * as THREE from 'three'
import type { Sky as SkyImpl } from 'three-stdlib'
import {
  compileTimeline,
  sampleTrack,
  type CompiledTimeline,
  type PlaybackClock,
  type Timeline,
  type TreeTrack,
} from './sceneState'
import WateringRobots from './WateringRobots'

/* Draco-compressed tree GLB. Lives in public/, served at root. */
const MODEL_URL = '/models/trees.glb'
useGLTF.preload(MODEL_URL)

/** Every tree is normalised to this height (metres) before `size` is applied. */
const TARGET_HEIGHT = 7

/* ------------------------------------------------------------------ */
/* Deterministic RNG so the scene is stable across re-renders.        */
/* ------------------------------------------------------------------ */
function mulberry32(seed: number) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ------------------------------------------------------------------ */
/* Procedural brown soil texture + bump.                              */
/* ------------------------------------------------------------------ */
function makeDirt() {
  const s = 512
  const color = document.createElement('canvas')
  color.width = color.height = s
  const cctx = color.getContext('2d')!
  const bump = document.createElement('canvas')
  bump.width = bump.height = s
  const bctx = bump.getContext('2d')!

  cctx.fillStyle = '#5a4026'
  cctx.fillRect(0, 0, s, s)
  bctx.fillStyle = '#808080'
  bctx.fillRect(0, 0, s, s)

  const rnd = mulberry32(42)
  const browns = ['#4a3320', '#63462a', '#6f4e2e', '#503a22', '#7a5836', '#3f2c1a']
  // Soil speckle: clumps of earth + small stones.
  for (let i = 0; i < 26000; i++) {
    const x = rnd() * s
    const y = rnd() * s
    const r = 0.6 + rnd() * 2.4
    cctx.fillStyle = browns[(rnd() * browns.length) | 0]
    cctx.globalAlpha = 0.35 + rnd() * 0.4
    cctx.beginPath()
    cctx.arc(x, y, r, 0, Math.PI * 2)
    cctx.fill()

    const bv = 90 + rnd() * 130
    bctx.globalAlpha = 0.4 + rnd() * 0.4
    bctx.fillStyle = `rgb(${bv},${bv},${bv})`
    bctx.beginPath()
    bctx.arc(x, y, r, 0, Math.PI * 2)
    bctx.fill()
  }
  // A few brighter pebbles.
  cctx.globalAlpha = 1
  for (let i = 0; i < 500; i++) {
    const x = rnd() * s
    const y = rnd() * s
    const r = 1 + rnd() * 2.5
    const g = 120 + rnd() * 70
    cctx.fillStyle = `rgb(${g},${g - 18},${g - 40})`
    cctx.beginPath()
    cctx.arc(x, y, r, 0, Math.PI * 2)
    cctx.fill()
  }
  cctx.globalAlpha = 1
  bctx.globalAlpha = 1

  const colorTex = new THREE.CanvasTexture(color)
  colorTex.colorSpace = THREE.SRGBColorSpace
  colorTex.wrapS = colorTex.wrapT = THREE.RepeatWrapping
  colorTex.repeat.set(6, 6)
  colorTex.anisotropy = 8
  const bumpTex = new THREE.CanvasTexture(bump)
  bumpTex.wrapS = bumpTex.wrapT = THREE.RepeatWrapping
  bumpTex.repeat.set(6, 6)
  return { colorTex, bumpTex }
}

/* ------------------------------------------------------------------ */
/* Natural soil plot: a flat rounded rectangle.                       */
/* ------------------------------------------------------------------ */
function sdRoundedRect(x: number, z: number, halfW: number, halfH: number, r: number) {
  const qx = Math.abs(x) - halfW + r
  const qz = Math.abs(z) - halfH + r
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - r
}

function makeSoilGeometry(halfSize: number, segments = 72) {
  const halfW = halfSize
  const halfH = halfSize
  const cornerR = Math.min(halfSize * 0.42, halfSize - 1)
  /** Flat, level with tree bases; meadow ground sits at y = -0.12. */
  const SOIL_Y = 0

  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  const grid: (number | null)[][] = []
  const step = (2 * halfW) / segments

  for (let i = 0; i <= segments; i++) {
    grid[i] = []
    for (let j = 0; j <= segments; j++) {
      const x = -halfW + i * step
      const z = -halfH + j * step
      if (sdRoundedRect(x, z, halfW, halfH, cornerR) > 0.02) {
        grid[i][j] = null
        continue
      }
      const idx = positions.length / 3
      positions.push(x, SOIL_Y, z)
      uvs.push(x / (2 * halfW) + 0.5, z / (2 * halfH) + 0.5)
      grid[i][j] = idx
    }
  }

  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < segments; j++) {
      const a = grid[i][j]
      const b = grid[i + 1][j]
      const c = grid[i][j + 1]
      const d = grid[i + 1][j + 1]
      if (a == null || b == null || c == null) continue
      indices.push(a, b, c)
      if (b == null || c == null || d == null) continue
      indices.push(b, d, c)
    }
  }

  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geom.setIndex(indices)
  geom.computeVertexNormals()
  return geom
}

/* ------------------------------------------------------------------ */
/* GLB tree variants                                                  */
/* ------------------------------------------------------------------ */
interface TreeTemplate {
  object: THREE.Object3D
  naturalHeight: number
}

const TREE_NAME = /^tree(\.\d+)?$/

/**
 * Load the GLB and pull each named tree variant out into a standalone
 * template: re-oriented upright (baking the model's world transform),
 * centred on the origin with its base at y=0, and shadow-enabled.
 */
function useTreeTemplates(): TreeTemplate[] {
  const { scene } = useGLTF(MODEL_URL)
  return useMemo(() => {
    scene.updateMatrixWorld(true)
    const variants: THREE.Object3D[] = []
    scene.traverse((o) => {
      if (TREE_NAME.test(o.name)) variants.push(o)
    })

    const q = new THREE.Quaternion()
    const sc = new THREE.Vector3()
    return variants.map((node) => {
      const object = node.clone(true)
      // Bake the node's world orientation + scale onto the clone root,
      // discarding its position within the original forest.
      node.getWorldQuaternion(q)
      node.getWorldScale(sc)
      object.position.set(0, 0, 0)
      object.quaternion.copy(q)
      object.scale.copy(sc)
      object.updateMatrixWorld(true)

      // Re-centre horizontally and drop onto the ground plane.
      const box = new THREE.Box3().setFromObject(object)
      const cx = (box.min.x + box.max.x) / 2
      const cz = (box.min.z + box.max.z) / 2
      object.position.set(-cx, -box.min.y, -cz)
      object.updateMatrixWorld(true)

      object.traverse((c) => {
        const m = c as THREE.Mesh
        if (m.isMesh) {
          m.castShadow = true
          m.receiveShadow = true
        }
      })

      return { object, naturalHeight: Math.max(0.001, box.max.y - box.min.y) }
    })
  }, [scene])
}

const AUTUMN = new THREE.Color('#b07a2a')

/* ------------------------------------------------------------------ */
/* Animated trees                                                     */
/*                                                                    */
/* One persistent group per tree (the union of every tree across all  */
/* frames). The playhead lives in `clock` and is advanced + applied   */
/* entirely inside the render loop, so growth is smooth and no React  */
/* re-render happens per animation frame.                             */
/* ------------------------------------------------------------------ */

/** Mutable playback state shared between the DOM controls and the render loop. */
export type { PlaybackClock } from './sceneState'

/** Apply seek / playback advance. Runs before lighting and tree updates each frame. */
function tickPlaybackClock(
  c: PlaybackClock,
  maxT: number,
  delta: number,
): number {
  if (c.seek !== null) {
    c.t = c.seek
    c.seek = null
  } else if (c.playing && maxT > 0) {
    c.t += delta * c.speed
    if (c.t > maxT) c.t = 0
  }
  c.t = Math.min(maxT, Math.max(0, c.t))
  return Math.round(c.t)
}

/* eslint-disable react-hooks/immutability */
function PlaybackClockController({
  clock,
  maxT,
  onProgress,
}: {
  clock: MutableRefObject<PlaybackClock>
  maxT: number
  onProgress: (day: number) => void
}) {
  const lastReported = useRef(-1)

  useFrame((_, delta) => {
    const day = tickPlaybackClock(clock.current, maxT, delta)
    if (day !== lastReported.current) {
      lastReported.current = day
      onProgress(day)
    }
  }, -1)

  return null
}
/* eslint-enable react-hooks/immutability */

interface TreeInstance {
  group: THREE.Group
  track: TreeTrack
  naturalHeight: number
  /** Cloned standard materials with their original colours, for health tinting. */
  materials: { mat: THREE.MeshStandardMaterial; base: THREE.Color }[]
}

function applyHealth(inst: TreeInstance, health: number) {
  for (const { mat, base } of inst.materials) {
    if (health < 0.985) {
      // Unhealthy trees shift toward a brown/yellow autumn tone.
      mat.color.copy(base).lerp(AUTUMN, (1 - health) * 0.7)
    } else {
      mat.color.copy(base)
    }
  }
}

function buildInstance(track: TreeTrack, templates: TreeTemplate[]): TreeInstance {
  const template = templates[track.seed % templates.length]
  const object = template.object.clone(true)
  const materials: TreeInstance['materials'] = []
  object.traverse((c) => {
    const m = c as THREE.Mesh
    if (!m.isMesh) return
    m.castShadow = true
    m.receiveShadow = true
    // Clone the material once so health tinting is a cheap per-frame colour
    // mutation rather than a re-clone every frame.
    const mat = (m.material as THREE.MeshStandardMaterial).clone()
    m.material = mat
    materials.push({ mat, base: mat.color.clone() })
  })
  const group = new THREE.Group()
  group.rotation.y = (track.seed % 360) * (Math.PI / 180)
  group.add(object)
  return { group, track, naturalHeight: template.naturalHeight, materials }
}

/*
 * Imperative animation: we own the tree groups, add them to the scene graph
 * directly, and mutate their transforms/materials every frame from the playback
 * clock. This is the standard react-three-fiber render-loop pattern, which the
 * react-hooks/immutability rule (designed around React-managed state) flags —
 * the engine objects here are deliberately not React state.
 */
/* eslint-disable react-hooks/immutability */
function AnimatedTrees({
  compiled,
  templates,
  clock,
}: {
  compiled: CompiledTimeline
  templates: TreeTemplate[]
  clock: MutableRefObject<PlaybackClock>
}) {
  const scene = useThree((s) => s.scene)
  // The animated trees are mutable engine objects we own outright, so we keep
  // them in a ref and add them straight to the scene graph rather than letting
  // React reconcile them — the render loop mutates them every frame.
  const store = useRef<{ instances: TreeInstance[] }>({
    instances: [],
  })

  // (Re)build instances whenever a new timeline loads, and reset the playhead.
  useEffect(() => {
    const instances = compiled.tracks.map((track) => buildInstance(track, templates))
    store.current.instances = instances
    clock.current.t = 0
    clock.current.seek = null
    for (const inst of instances) scene.add(inst.group)
    return () => {
      for (const inst of instances) {
        scene.remove(inst.group)
        for (const { mat } of inst.materials) mat.dispose()
      }
    }
  }, [compiled, templates, scene, clock])

  useFrame(() => {
    const c = clock.current
    const treeT = c.playing ? c.t : Math.round(c.t)

    for (const inst of store.current.instances) {
      const s = sampleTrack(inst.track, treeT)
      inst.group.visible = s.visible
      if (!s.visible) continue
      inst.group.scale.setScalar((TARGET_HEIGHT / inst.naturalHeight) * s.size)
      inst.group.position.set(s.x, 0, -s.y)
      applyHealth(inst, s.health)
    }
  })

  return null
}
/* eslint-enable react-hooks/immutability */

/* ------------------------------------------------------------------ */
/* Natural brown soil floor for the tree plot.                        */
/* ------------------------------------------------------------------ */
function Soil({ halfSize }: { halfSize: number }) {
  const dirt = useMemo(() => makeDirt(), [])
  const geometry = useMemo(() => makeSoilGeometry(halfSize), [halfSize])
  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial
        map={dirt.colorTex}
        bumpMap={dirt.bumpTex}
        bumpScale={0.08}
        roughness={1}
        metalness={0}
        color="#8a6a45"
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

/* ------------------------------------------------------------------ */
/* Grass meadow surrounding the soil plot.                            */
/* ------------------------------------------------------------------ */
function makeGrassTex() {
  const s = 512
  const color = document.createElement('canvas')
  color.width = color.height = s
  const cctx = color.getContext('2d')!
  cctx.fillStyle = '#3d7a2a'
  cctx.fillRect(0, 0, s, s)
  const rnd = mulberry32(21)
  const greens = ['#356d24', '#4a8f33', '#2f6320', '#58a33d', '#6cae46', '#417a2c']
  for (let i = 0; i < 22000; i++) {
    const x = rnd() * s
    const y = rnd() * s
    const len = 2 + rnd() * 6
    const ang = -Math.PI / 2 + (rnd() - 0.5) * 0.8
    cctx.strokeStyle = greens[(rnd() * greens.length) | 0]
    cctx.lineWidth = 0.6 + rnd() * 1.2
    cctx.beginPath()
    cctx.moveTo(x, y)
    cctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len)
    cctx.stroke()
  }
  const tex = new THREE.CanvasTexture(color)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(50, 50)
  tex.anisotropy = 8
  return tex
}

/** A single thin, tapered, slightly-bent grass blade with a dark→light gradient. */
function makeBladeGeometry() {
  const g = new THREE.PlaneGeometry(0.05, 0.55, 1, 4)
  const pos = g.attributes.position
  const colors: number[] = []
  const dark = new THREE.Color('#2c5e1e')
  const light = new THREE.Color('#7ec24f')
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) + 0.275
    const t = y / 0.55
    pos.setX(pos.getX(i), pos.getX(i) * (1 - t * 0.9))
    pos.setZ(pos.getZ(i), Math.pow(t, 2) * 0.18)
    const col = dark.clone().lerp(light, t)
    colors.push(col.r, col.g, col.b)
  }
  g.translate(0, 0.275, 0)
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  g.computeVertexNormals()
  return g
}

/** Green ground plane + instanced grass blades, kept in a ring outside the plot. */
function Meadow({ soilHalfSize }: { soilHalfSize: number }) {
  const tex = useMemo(() => makeGrassTex(), [])
  const blade = useMemo(() => makeBladeGeometry(), [])
  const COUNT = 16000
  const ref = useRef<THREE.InstancedMesh>(null!)

  // Start the ring just beyond the rounded-rect corners.
  const inner = soilHalfSize * 1.35
  const outer = inner + 34

  useEffect(() => {
    const rnd = mulberry32(123)
    const dummy = new THREE.Object3D()
    let placed = 0
    for (let i = 0; i < COUNT; i++) {
      const a = rnd() * Math.PI * 2
      // Uniform over the annulus area.
      const r = Math.sqrt(inner * inner + rnd() * (outer * outer - inner * inner))
      dummy.position.set(Math.cos(a) * r, -0.05, Math.sin(a) * r)
      dummy.rotation.set(0, rnd() * Math.PI, 0)
      dummy.scale.set(0.8 + rnd() * 0.6, 0.6 + rnd() * 1.0, 1)
      dummy.updateMatrix()
      ref.current.setMatrixAt(placed++, dummy.matrix)
    }
    ref.current.count = placed
    ref.current.instanceMatrix.needsUpdate = true
  }, [inner, outer])

  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.12, 0]} receiveShadow>
        <planeGeometry args={[300, 300]} />
        <meshStandardMaterial
          map={tex}
          color="#86b35c"
          roughness={1}
          metalness={0}
        />
      </mesh>
      <instancedMesh ref={ref} args={[blade, undefined, COUNT]} receiveShadow>
        <meshStandardMaterial vertexColors side={THREE.DoubleSide} roughness={0.85} metalness={0} />
      </instancedMesh>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Day/night cycle driven by the playback clock.                      */
/*                                                                    */
/* The playhead (0 .. maxT) is mapped to one full solar day. The sun  */
/* orbits, light colour/intensity and sky/fog/exposure shift, and     */
/* stars fade in at night — all mutated in the render loop so there's  */
/* no per-frame React re-render.                                      */
/* ------------------------------------------------------------------ */
const SUN_START: [number, number, number] = [38, 30, 20]
const DAY_WHITE = new THREE.Color('#fff4e0')
const SUNSET = new THREE.Color('#ff7a2c')
const DAY_SKY = new THREE.Color('#bfe0ff')
const NIGHT_SKY = new THREE.Color('#4a6088')
const DAY_FOG = new THREE.Color('#cfe6f5')
const NIGHT_FOG = new THREE.Color('#243552')
const _dir = new THREE.Vector3()

/* eslint-disable react-hooks/immutability */
function DayNight({ clock }: { clock: MutableRefObject<PlaybackClock> }) {
  const sun = useRef<THREE.DirectionalLight>(null!)
  const moon = useRef<THREE.DirectionalLight>(null!)
  const hemi = useRef<THREE.HemisphereLight>(null!)
  const sky = useRef<SkyImpl>(null!)
  const stars = useRef<THREE.Group>(null!)
  const { scene, gl } = useThree()

  useFrame(() => {
    // One full day per unit of t: cos → noon at integer t, midnight at +0.5.
    const ang = clock.current.t * Math.PI * 2
    const elev = Math.cos(ang)
    const az = Math.sin(ang)
    _dir.set(az * 0.85, elev, 0.5).normalize()

    const day = THREE.MathUtils.smoothstep(elev, -0.05, 0.28) // 0 night → 1 day
    const high = THREE.MathUtils.smoothstep(elev, 0.1, 0.55) // 0 horizon → 1 noon

    // Sun
    const s = sun.current
    s.position.set(_dir.x * 80, _dir.y * 80, _dir.z * 80)
    s.intensity = day * 3.4
    s.color.copy(SUNSET).lerp(DAY_WHITE, high)
    s.visible = day > 0.002

    // Moon fill (cool, no shadow) for legibility at night
    const m = moon.current
    m.intensity = (1 - day) * 0.55
    m.visible = m.intensity > 0.002

    // Hemisphere
    const h = hemi.current
    h.intensity = THREE.MathUtils.lerp(0.32, 0.55, day)
    h.color.copy(NIGHT_SKY).lerp(DAY_SKY, day)

    // Sky dome follows the sun
    if (sky.current) {
      const u = (sky.current.material as THREE.ShaderMaterial).uniforms
      u.sunPosition.value.copy(_dir)
    }

    // Fog + exposure darken/cool at night (kept soft so dusk isn't jarring)
    const fog = scene.fog as THREE.Fog | null
    if (fog) fog.color.copy(NIGHT_FOG).lerp(DAY_FOG, day)
    gl.toneMappingExposure = THREE.MathUtils.lerp(0.72, 1.05, day)

    // Stars fade in only deep into night
    if (stars.current) {
      stars.current.visible = day < 0.18
    }
  })

  return (
    <>
      <Sky
        ref={sky}
        sunPosition={SUN_START}
        turbidity={3}
        rayleigh={0.5}
        mieCoefficient={0.005}
        mieDirectionalG={0.85}
      />
      <group ref={stars}>
        <Stars radius={150} depth={60} count={1500} factor={4} saturation={0} fade speed={0} />
      </group>
      <hemisphereLight ref={hemi} args={['#bfe0ff', '#3d6b2a', 0.5]} />
      <directionalLight
        ref={sun}
        position={SUN_START}
        intensity={3.4}
        color="#fff4e0"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.04}
        shadow-camera-left={-30}
        shadow-camera-right={30}
        shadow-camera-top={30}
        shadow-camera-bottom={-30}
        shadow-camera-near={0.5}
        shadow-camera-far={120}
      />
      <directionalLight ref={moon} position={[-28, 55, -18]} intensity={0} color="#5d76b0" />
    </>
  )
}
/* eslint-enable react-hooks/immutability */

/* ------------------------------------------------------------------ */
/* Scene                                                              */
/* ------------------------------------------------------------------ */
function Scene({
  compiled,
  clock,
  onProgress,
  wateringFlags,
}: {
  compiled: CompiledTimeline
  clock: MutableRefObject<PlaybackClock>
  onProgress: (t: number) => void
  wateringFlags: boolean[]
}) {
  const templates = useTreeTemplates()
  const soilHalf = compiled.fieldHalf + 3
  const maxT = Math.max(0, compiled.frameCount - 1)

  return (
    <>
      <fog attach="fog" args={['#cfe6f5', 55, 130]} />

      <PlaybackClockController clock={clock} maxT={maxT} onProgress={onProgress} />
      <DayNight clock={clock} />

      <Environment resolution={256}>
        <Lightformer intensity={3} color="#fff3d6" position={[10, 10, 6]} scale={[10, 10, 1]} />
        <Lightformer intensity={0.7} color="#bcd8ff" position={[0, 5, -10]} scale={[20, 20, 1]} />
        <Lightformer
          intensity={0.45}
          color="#6a9f4a"
          position={[0, -6, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          scale={[30, 30, 1]}
        />
      </Environment>

      <Meadow soilHalfSize={soilHalf} />
      <Soil halfSize={soilHalf} />

      {templates.length > 0 && (
        <AnimatedTrees
          compiled={compiled}
          templates={templates}
          clock={clock}
        />
      )}

      <WateringRobots
        fieldHalf={soilHalf}
        wateringFlags={wateringFlags}
        clock={clock}
      />

      <Clouds material={THREE.MeshBasicMaterial}>
        <Cloud position={[-18, 24, -28]} speed={0.15} opacity={0.7} bounds={[12, 4, 4]} />
        <Cloud position={[16, 26, -34]} speed={0.15} opacity={0.55} bounds={[14, 4, 4]} />
        <Cloud position={[2, 30, -45]} speed={0.1} opacity={0.5} bounds={[18, 5, 4]} />
      </Clouds>
    </>
  )
}

export default function TreeScene({
  timeline,
  clock,
  onProgress,
  wateringFlags,
}: {
  timeline: Timeline
  clock: MutableRefObject<PlaybackClock>
  onProgress: (t: number) => void
  wateringFlags: boolean[]
}) {
  const compiled = useMemo(() => compileTimeline(timeline), [timeline])
  const camZ = Math.max(42, compiled.fieldHalf * 1.45)
  const camY = Math.max(16, compiled.fieldHalf * 0.36)
  return (
    <Canvas
      shadows="soft"
      dpr={[1, 2]}
      camera={{ position: [0, camY, camZ], fov: 45 }}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
      style={{ borderRadius: 8 }}
    >
      <Suspense fallback={null}>
        <Scene compiled={compiled} clock={clock} onProgress={onProgress} wateringFlags={wateringFlags} />
      </Suspense>
      <OrbitControls
        enablePan={false}
        minDistance={12}
        maxDistance={Math.max(70, compiled.fieldHalf * 2.2)}
        maxPolarAngle={Math.PI / 2.05}
        target={[0, 3, 0]}
      />
    </Canvas>
  )
}
