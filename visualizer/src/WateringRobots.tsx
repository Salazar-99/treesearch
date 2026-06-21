import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { MutableRefObject } from 'react'
import { sampleWatering, type PlaybackClock } from './sceneState'

const ROBOT_COUNT = 4
const BODY = new THREE.Color('#6b8cae')
const ACCENT = new THREE.Color('#4a90c4')
const TANK = new THREE.Color('#7ec8e3')

interface RobotPath {
  cx: number
  cz: number
  rx: number
  rz: number
  speed: number
  phase: number
  wobble: number
}

function makePaths(fieldHalf: number): RobotPath[] {
  const span = fieldHalf * 0.72
  return Array.from({ length: ROBOT_COUNT }, (_, i) => ({
    cx: (i % 2 === 0 ? -1 : 1) * span * 0.18 * (i % 3),
    cz: (i < 2 ? -1 : 1) * span * 0.14 * (i % 2),
    rx: span * (0.55 + (i % 3) * 0.12),
    rz: span * (0.45 + (i % 2) * 0.15),
    speed: 0.55 + i * 0.12,
    phase: (i / ROBOT_COUNT) * Math.PI * 2,
    wobble: 0.08 + i * 0.02,
  }))
}

function RobotMesh({
  path,
  activityRef,
  timeRef,
}: {
  path: RobotPath
  activityRef: MutableRefObject<number>
  timeRef: MutableRefObject<number>
}) {
  const root = useRef<THREE.Group>(null!)
  const legL = useRef<THREE.Mesh>(null!)
  const legR = useRef<THREE.Mesh>(null!)
  const armL = useRef<THREE.Group>(null!)
  const hose = useRef<THREE.Mesh>(null!)
  const spray = useRef<THREE.Mesh>(null!)

  useFrame(() => {
    const activity = activityRef.current
    const time = timeRef.current
    if (!root.current || activity < 0.02) {
      root.current.visible = false
      return
    }
    root.current.visible = true

    const walk = time * path.speed + path.phase
    const x = path.cx + Math.cos(walk) * path.rx
    const z = path.cz + Math.sin(walk * 1.17) * path.rz
    const heading = Math.atan2(
      -Math.sin(walk * 1.17) * path.rz * 1.17,
      -Math.sin(walk) * path.rx,
    )

    root.current.position.set(x, 0, z)
    root.current.rotation.y = heading
    root.current.scale.setScalar(0.85 + activity * 0.15)

    const stride = Math.sin(walk * 6) * path.wobble * activity
    legL.current.position.y = 0.11 + Math.max(0, stride)
    legR.current.position.y = 0.11 + Math.max(0, -stride)
    armL.current.rotation.x = -0.35 + Math.sin(walk * 5) * 0.25 * activity
    hose.current.rotation.z = 0.4 + Math.sin(walk * 8) * 0.15 * activity
    const mat = spray.current.material as THREE.MeshStandardMaterial
    mat.emissiveIntensity = 0.35 * activity
  })

  return (
    <group ref={root}>
      <mesh position={[0, 0.38, 0]} castShadow>
        <boxGeometry args={[0.42, 0.34, 0.28]} />
        <meshStandardMaterial color={BODY} roughness={0.55} metalness={0.15} />
      </mesh>
      <mesh position={[0, 0.52, -0.12]} castShadow>
        <cylinderGeometry args={[0.1, 0.11, 0.22, 8]} />
        <meshStandardMaterial color={TANK} roughness={0.35} metalness={0.25} />
      </mesh>
      <mesh position={[0, 0.62, 0.06]} castShadow>
        <boxGeometry args={[0.28, 0.22, 0.22]} />
        <meshStandardMaterial color={ACCENT} roughness={0.5} metalness={0.2} />
      </mesh>
      <mesh position={[-0.07, 0.64, 0.18]}>
        <sphereGeometry args={[0.035, 8, 8]} />
        <meshStandardMaterial color="#1a2433" roughness={0.3} />
      </mesh>
      <mesh position={[0.07, 0.64, 0.18]}>
        <sphereGeometry args={[0.035, 8, 8]} />
        <meshStandardMaterial color="#1a2433" roughness={0.3} />
      </mesh>
      <mesh ref={legL} position={[-0.1, 0.11, 0]} castShadow>
        <boxGeometry args={[0.1, 0.22, 0.12]} />
        <meshStandardMaterial color={BODY} roughness={0.6} />
      </mesh>
      <mesh ref={legR} position={[0.1, 0.11, 0]} castShadow>
        <boxGeometry args={[0.1, 0.22, 0.12]} />
        <meshStandardMaterial color={BODY} roughness={0.6} />
      </mesh>
      <group ref={armL} position={[-0.24, 0.42, 0.04]}>
        <mesh castShadow>
          <boxGeometry args={[0.12, 0.08, 0.08]} />
          <meshStandardMaterial color={ACCENT} roughness={0.55} />
        </mesh>
        <mesh ref={hose} position={[-0.1, -0.02, 0.06]} rotation={[0.3, 0, 0.4]} castShadow>
          <cylinderGeometry args={[0.025, 0.03, 0.28, 6]} />
          <meshStandardMaterial color="#3d8fbf" roughness={0.4} metalness={0.1} />
        </mesh>
        <mesh ref={spray} position={[-0.1, -0.16, 0.1]}>
          <sphereGeometry args={[0.04, 6, 6]} />
          <meshStandardMaterial
            color="#9edcff"
            emissive="#4ab8ff"
            emissiveIntensity={0}
            transparent
            opacity={0.85}
          />
        </mesh>
      </group>
    </group>
  )
}

export default function WateringRobots({
  fieldHalf,
  wateringFlags,
  clock,
}: {
  fieldHalf: number
  wateringFlags: boolean[]
  clock: MutableRefObject<PlaybackClock>
}) {
  const paths = useMemo(() => makePaths(fieldHalf), [fieldHalf])
  const activityRef = useRef(0)
  const timeRef = useRef(0)

  useFrame((_, delta) => {
    activityRef.current = sampleWatering(wateringFlags, clock.current.t)
    timeRef.current += delta * (clock.current.playing ? clock.current.speed : 0.35)
  })

  return (
    <group>
      {paths.map((path, i) => (
        <RobotMesh key={i} path={path} activityRef={activityRef} timeRef={timeRef} />
      ))}
    </group>
  )
}
