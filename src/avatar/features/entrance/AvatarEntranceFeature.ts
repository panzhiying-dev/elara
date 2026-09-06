import * as THREE from 'three'
import type { AvatarFeature, AvatarFeatureContext } from '../../AvatarFeature'

export type EntranceAnimationName = 'walkForward' | 'turn' | 'modelPose'
export type EntranceSide = 'left' | 'right' | 'top' | 'bottom'
export type EntranceAnimationPlayer = (
  name: EntranceAnimationName,
  options?: {
    stripRootTranslation?: boolean
    fadeDuration?: number
    loop?: THREE.AnimationActionLoopStyles
    repetitions?: number
    clampWhenFinished?: boolean
  },
) => Promise<void>

export interface AvatarEntranceFeatureOptions {
  enabled?: boolean
  speed?: number
  target?: THREE.Vector3
  entrySide?: EntranceSide
  arrivalThreshold?: number
  turnDuration?: number
}

/** 根据当前相机视口计算入场距离，并只使用 AvatarRoot 驱动真实位移。 */
export class AvatarEntranceFeature implements AvatarFeature {
  private readonly options: Required<Omit<AvatarEntranceFeatureOptions, 'target'>> & { target?: THREE.Vector3 }
  private readonly playAnimation: EntranceAnimationPlayer
  private readonly direction = new THREE.Vector3()
  private readonly currentPosition = new THREE.Vector3()
  private readonly entryPosition = new THREE.Vector3()
  private readonly targetPosition = new THREE.Vector3()
  private readonly originalRotation = new THREE.Euler()
  private readonly rightAxis = new THREE.Vector3()
  private readonly upAxis = new THREE.Vector3()
  private readonly bounds = new THREE.Box3()
  private readonly raycaster = new THREE.Raycaster()
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  private readonly targetNdc = new THREE.Vector3()
  private readonly sideNdc = new THREE.Vector2()
  private readonly groundIntersection = new THREE.Vector3()
  private context: AvatarFeatureContext | null = null
  private enabled: boolean
  private started = false
  private running = false
  private turning = false
  private turnElapsedSeconds = 0
  private turnStartYaw = 0
  private turnDeltaYaw = 0
  private travelDistance = 0
  private travelElapsedSeconds = 0
  private movementDurationSeconds = 0
  private completed = false
  private exiting = false
  private exitResolve: (() => void) | null = null

  private constructor(playAnimation: EntranceAnimationPlayer, options: AvatarEntranceFeatureOptions = {}) {
    this.playAnimation = playAnimation
    this.options = {
      enabled: options.enabled ?? true,
      speed: Math.max(options.speed ?? 1.2, 0),
      target: options.target?.clone(),
      entrySide: options.entrySide ?? 'right',
      arrivalThreshold: Math.max(options.arrivalThreshold ?? 0.01, 0.0001),
      turnDuration: Math.max(options.turnDuration ?? 1, 0.05),
    }
    this.enabled = this.options.enabled
  }

  public static create(playAnimation: EntranceAnimationPlayer, options: AvatarEntranceFeatureOptions = {}): AvatarEntranceFeature {
    return new AvatarEntranceFeature(playAnimation, options)
  }

  public init(context: AvatarFeatureContext): void {
    if (!this.context) this.context = context
  }

  public async start(): Promise<void> {
    if (this.started || this.completed || !this.context) return
    const avatarRoot = this.context.getAvatarRoot()
    if (!avatarRoot) return
    this.started = true
    if (!this.enabled) {
      this.completed = true
      return
    }
    this.targetPosition.copy(this.options.target ?? avatarRoot.position)
    this.targetPosition.y = this.context.groundY
    this.calculateEntryPosition(avatarRoot)
    this.originalRotation.copy(avatarRoot.rotation)
    avatarRoot.position.copy(this.currentPosition)
    this.entryPosition.copy(this.currentPosition)
    this.travelDistance = this.entryPosition.distanceTo(this.targetPosition)
    this.travelElapsedSeconds = 0
    this.movementDurationSeconds =
      this.options.speed > 0 ? this.travelDistance / this.options.speed : Infinity
    // VRM 0.x 已由 VRMUtils.rotateVRM0 施加 180° 场景修正；保留该半周偏移，
    // 才能让模型视觉前方与 WalkForward 的本地 +Z 移动方向一致。
    avatarRoot.rotation.y = Math.atan2(this.direction.x, this.direction.z) + Math.PI
    await this.playAnimation('walkForward', {
      stripRootTranslation: true,
      fadeDuration: 0.12,
      loop: THREE.LoopRepeat,
      repetitions: Infinity,
    })
    if (!this.context || this.completed || !this.enabled) return
    this.running = true
  }

  /** 重置当前模型的入场状态，供模型切换后再次使用。 */
  public resetForEntry(): void {
    this.started = false
    this.running = false
    this.turning = false
    this.exiting = false
    this.completed = false
    this.exitResolve = null
    this.travelElapsedSeconds = 0
    this.turnElapsedSeconds = 0
  }

  /**
   * 驱动当前模型沿屏幕边缘方向真实移动到视口外。
   * Promise 仅在 update() 确认模型已经到达屏幕外位置后完成。
   */
  public async exit(): Promise<void> {
    if (this.exiting) {
      return new Promise<void>((resolve) => {
        const previousResolve = this.exitResolve
        this.exitResolve = () => {
          previousResolve?.()
          resolve()
        }
      })
    }
    const avatarRoot = this.context?.getAvatarRoot()
    if (!avatarRoot) return

    this.exiting = true
    this.running = false
    this.turning = false
    this.calculateExitPosition(avatarRoot)
    this.entryPosition.copy(avatarRoot.position)
    this.travelDistance = this.entryPosition.distanceTo(this.targetPosition)
    this.travelElapsedSeconds = 0
    this.movementDurationSeconds =
      this.options.speed > 0 ? this.travelDistance / this.options.speed : Infinity
    avatarRoot.rotation.y = Math.atan2(this.direction.x, this.direction.z) + Math.PI
    await this.playAnimation('walkForward', {
      stripRootTranslation: true,
      fadeDuration: 0.12,
      loop: THREE.LoopRepeat,
      repetitions: Infinity,
    })
    if (!this.exiting) return
    this.running = true
    await new Promise<void>((resolve) => {
      this.exitResolve = resolve
    })
  }

  public update(deltaSeconds: number): void {
    if (!this.context || deltaSeconds <= 0) return
    const avatarRoot = this.context.getAvatarRoot()
    if (!avatarRoot) return
    if (this.turning) {
      this.turnElapsedSeconds += deltaSeconds
      const progress = THREE.MathUtils.clamp(this.turnElapsedSeconds / this.options.turnDuration, 0, 1)
      avatarRoot.rotation.y = this.turnStartYaw + this.turnDeltaYaw * progress
      if (progress >= 1) {
        avatarRoot.rotation.copy(this.originalRotation)
        this.turning = false
        this.completed = true
        void this.playAnimation('modelPose', {
          stripRootTranslation: true,
          fadeDuration: 0.16,
          loop: THREE.LoopRepeat,
          repetitions: Infinity,
        })
      }
      return
    }
    if (!this.running) return
    this.travelElapsedSeconds = Math.min(
      this.travelElapsedSeconds + deltaSeconds,
      this.movementDurationSeconds,
    )
    const travelled = Math.min(
      this.options.speed * this.travelElapsedSeconds,
      this.travelDistance,
    )
    avatarRoot.position.copy(this.entryPosition).addScaledVector(this.direction, travelled)
    const remaining = this.targetPosition.distanceTo(avatarRoot.position)
    if (
      remaining <= this.options.arrivalThreshold ||
      travelled >= this.travelDistance
    ) {
      avatarRoot.position.copy(this.targetPosition)
      this.running = false
      if (this.exiting) {
        this.exiting = false
        this.exitResolve?.()
        this.exitResolve = null
        return
      }
      this.turnStartYaw = avatarRoot.rotation.y
      this.turnDeltaYaw = Math.atan2(Math.sin(this.originalRotation.y - this.turnStartYaw), Math.cos(this.originalRotation.y - this.turnStartYaw))
      this.turnElapsedSeconds = 0
      this.turning = true
      // 直线路径不需要额外 Turn VRMA；Turn.vrma 本身仍含约 0.144 单位位移。
      // 仅平滑旋转 AvatarRoot，避免再次引入 hips 位移或错误的固定转身角度。
      void this.playAnimation('modelPose', {
        fadeDuration: 0.16,
        loop: THREE.LoopRepeat,
        repetitions: Infinity,
      })
      return
    }
  }

  public isCompleted(): boolean { return this.completed }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (!enabled && (this.running || this.turning)) {
      this.running = false
      this.turning = false
      this.completed = true
      const avatarRoot = this.context?.getAvatarRoot()
      if (avatarRoot) {
        avatarRoot.position.copy(this.targetPosition)
        avatarRoot.rotation.copy(this.originalRotation)
      }
      void this.playAnimation('modelPose', {
        stripRootTranslation: true,
        fadeDuration: 0.12,
        loop: THREE.LoopRepeat,
        repetitions: Infinity,
      })
    }
  }

  public dispose(): void {
    this.running = false
    this.turning = false
    this.exiting = false
    this.exitResolve?.()
    this.exitResolve = null
    this.context = null
  }

  /** 根据当前相机和模型尺寸计算屏幕外的离场目标点。 */
  private calculateExitPosition(avatarRoot: THREE.Object3D): void {
    const context = this.context
    if (!context) return
    const camera = context.camera
    camera.updateMatrixWorld(true)
    this.rightAxis.setFromMatrixColumn(camera.matrixWorld, 0).normalize()
    this.rightAxis.y = 0
    if (this.rightAxis.lengthSq() < 0.0001) this.rightAxis.set(1, 0, 0)
    else this.rightAxis.normalize()
    this.upAxis.setFromMatrixColumn(camera.matrixWorld, 1).normalize()
    this.upAxis.y = 0
    if (this.upAxis.lengthSq() < 0.0001) this.upAxis.set(0, 0, 1)
    else this.upAxis.normalize()
    this.bounds.setFromObject(avatarRoot)
    const size = this.bounds.getSize(new THREE.Vector3())
    const margin = Math.max(size.x, size.z) * 0.5 + 0.08
    const horizontal = this.options.entrySide === 'left' || this.options.entrySide === 'right'
    const axis = horizontal ? this.rightAxis : this.upAxis
    // 入场从哪一侧来，离场就向相反侧移动，确保完整穿过视口。
    const sign = this.options.entrySide === 'left' || this.options.entrySide === 'bottom' ? 1 : -1
    this.targetPosition.copy(avatarRoot.position).addScaledVector(axis, sign * (margin + 1))
    this.targetPosition.y = context.groundY
    this.direction.copy(this.targetPosition).sub(avatarRoot.position).normalize()
  }

  private calculateEntryPosition(avatarRoot: THREE.Object3D): void {
    const context = this.context
    if (!context) return
    const camera = context.camera
    const width = Math.max(context.renderer.domElement.clientWidth, 1)
    const height = Math.max(context.renderer.domElement.clientHeight, 1)
    if (camera instanceof THREE.PerspectiveCamera) {
      const viewportAspect = width / height
      if (Math.abs(camera.aspect - viewportAspect) > 0.0001) {
        camera.aspect = viewportAspect
        camera.updateProjectionMatrix()
      }
    }
    camera.updateMatrixWorld(true)
    this.groundPlane.constant = -context.groundY
    this.rightAxis.setFromMatrixColumn(camera.matrixWorld, 0).normalize()
    this.rightAxis.y = 0
    if (this.rightAxis.lengthSq() < 0.0001) this.rightAxis.set(1, 0, 0)
    else this.rightAxis.normalize()
    this.upAxis.setFromMatrixColumn(camera.matrixWorld, 1).normalize()
    this.upAxis.y = 0
    if (this.upAxis.lengthSq() < 0.0001) this.upAxis.set(0, 0, 1)
    else this.upAxis.normalize()
    this.bounds.setFromObject(avatarRoot)
    const size = this.bounds.getSize(new THREE.Vector3())
    const margin = Math.max(size.x, size.z) * 0.5 + 0.08
    const horizontal = this.options.entrySide === 'left' || this.options.entrySide === 'right'
    const axis = horizontal ? this.rightAxis : this.upAxis
    const sign = this.options.entrySide === 'left' || this.options.entrySide === 'bottom' ? -1 : 1
    this.targetNdc.copy(this.targetPosition).project(camera)
    const edgeCoordinate = sign < 0 ? -1 : 1
    this.sideNdc.set(
      horizontal ? edgeCoordinate : THREE.MathUtils.clamp(this.targetNdc.x, -1, 1),
      horizontal ? THREE.MathUtils.clamp(this.targetNdc.y, -1, 1) : edgeCoordinate,
    )
    const edgePoint = this.intersectGround(this.sideNdc, camera)
    if (edgePoint) {
      this.currentPosition.copy(edgePoint).addScaledVector(axis, sign * margin)
    } else {
      // 相机几乎水平时顶部/底部射线可能与 Ground 平行，使用稳定的世界空间回退。
      this.currentPosition.copy(this.targetPosition).addScaledVector(axis, sign * (margin + 1))
    }
    this.currentPosition.y = context.groundY
    this.direction.copy(this.targetPosition).sub(this.currentPosition).normalize()
  }

  private intersectGround(ndc: THREE.Vector2, camera: THREE.Camera): THREE.Vector3 | null {
    this.raycaster.setFromCamera(ndc, camera)
    return this.raycaster.ray.intersectPlane(this.groundPlane, this.groundIntersection)
  }
}
