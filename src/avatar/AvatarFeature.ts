import * as THREE from 'three'

export interface AvatarFeatureContext {
  scene: THREE.Scene
  renderer: THREE.WebGLRenderer
  camera: THREE.Camera
  getAvatarRoot: () => THREE.Object3D | null
  groundY: number
}

/** AvatarViewer 可插拔功能的统一生命周期。 */
export interface AvatarFeature {
  init(context: AvatarFeatureContext): void
  update(deltaSeconds: number): void
  setEnabled(enabled: boolean): void
  dispose(): void
}
