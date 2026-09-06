import * as THREE from 'three'

export interface SceneConfig {
  backgroundColor: number
}

export interface GroundConfig {
  size: number
  color: number
  roughness: number
  metalness: number
}

export interface CameraConfig {
  fov: number
  near: number
  far: number
  position: THREE.Vector3
}

export interface RendererOutputConfig {
  antialias: boolean
  alpha: boolean
  pixelRatio: number
  /** 保留最后一帧缓冲，允许 Camera Mode 使用 canvas.toBlob() 拍照。 */
  preserveDrawingBuffer: boolean
}

export interface LightingConfig {
  ambientColor: number
  ambientIntensity: number
  hemisphereSkyColor: number
  hemisphereGroundColor: number
  hemisphereIntensity: number
  keyColor: number
  keyIntensity: number
  keyPosition: THREE.Vector3
  fillColor: number
  fillIntensity: number
  fillPosition: THREE.Vector3
}

export interface DebugConfig {
  showGrid: boolean
  showAxes: boolean
  gridSize: number
  gridDivisions: number
  gridPrimaryColor: number
  gridSecondaryColor: number
  axesSize: number
}

export interface ControlsConfig {
  enableDamping: boolean
  dampingFactor: number
  minDistance: number
  maxDistance: number
  minPolarAngle: number
  maxPolarAngle: number
  screenSpacePanning: boolean
  zoomSpeed: number
}

export interface RendererConfig {
  scene: SceneConfig
  ground: GroundConfig
  camera: CameraConfig
  renderer: RendererOutputConfig
  lighting: LightingConfig
  debug: DebugConfig
  controls: ControlsConfig
}

/** ThreeRenderer 的稳定默认配置；运行时状态仍由 ThreeRenderer 自己管理。 */
export const DEFAULT_RENDERER_CONFIG: RendererConfig = {
  scene: {
    backgroundColor: 0xf5f5f5,
  },
  ground: {
    size: 20,
    color: 0xf5f5f5,
    roughness: 0.9,
    metalness: 0,
  },
  camera: {
    fov: 30,
    near: 0.01,
    far: 1000,
    position: new THREE.Vector3(-0.028, 1.532, 1.915),
  },
  renderer: {
    antialias: true,
    alpha: false,
    pixelRatio: window.devicePixelRatio,
    preserveDrawingBuffer: true,
  },
  lighting: {
    ambientColor: 0xffffff,
    ambientIntensity: 0.8,
    hemisphereSkyColor: 0xc7dcff,
    hemisphereGroundColor: 0x38404d,
    hemisphereIntensity: 1.1,
    keyColor: 0xffffff,
    keyIntensity: 2.2,
    keyPosition: new THREE.Vector3(1, 2, 3),
    fillColor: 0x9db8ff,
    fillIntensity: 0.8,
    fillPosition: new THREE.Vector3(-2, 1.5, -2),
  },
  debug: {
    showGrid: false,
    showAxes: false,
    gridSize: 20,
    gridDivisions: 20,
    gridPrimaryColor: 0x667085,
    gridSecondaryColor: 0x3e4759,
    axesSize: 2,
  },
  controls: {
    enableDamping: true,
    dampingFactor: 0.12,
    minDistance: 1.9968,
    maxDistance: 8,
    minPolarAngle: 0.2,
    maxPolarAngle: Math.PI * 0.85,
    screenSpacePanning: true,
    zoomSpeed: 0.35,
  },
}
