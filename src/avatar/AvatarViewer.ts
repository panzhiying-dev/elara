import * as THREE from 'three'
import { VRM } from '@pixiv/three-vrm'
import { AvatarLoader } from './AvatarLoader'
import { AnimationManager } from './managers/AnimationManager'
import { ModelManager } from './managers/ModelManager'
import {
  ModelTransitionController,
  type ModelTransitionChange,
} from './transition/ModelTransitionController'
import { AvatarFeatureManager } from './features/AvatarFeatureManager'
import { AvatarShadowFeature } from './features/shadow/AvatarShadowFeature'
import {
  AvatarExpressionFeature,
  type AvatarExpressionDescriptor,
  type AvatarEmotion,
  type AvatarMouth,
} from './features/expression/AvatarExpressionFeature'
import type { PresentationDebugState } from './features/expression/AvatarPresentationController'
import {
  AvatarEntranceFeature,
  type AvatarEntranceFeatureOptions,
} from './features/entrance/AvatarEntranceFeature'
import {
  ThreeRenderer,
  type ThreeRendererOptions,
} from '../renderer/ThreeRenderer'
import { DEFAULT_MODEL_ID } from '../Model'
import { getAnimationDefinition, type AvatarAnimationName } from '../vrma'
import type { LipSyncWeights } from '../lipsync/LipSyncTypes'
import { LipSyncPlayer } from '../lipsync/LipSyncPlayer'

export interface AvatarViewerOptions extends ThreeRendererOptions {
  shadow?: boolean
  entrance?: boolean | AvatarEntranceFeatureOptions
  onExpressionsChanged?: (expressions: AvatarExpressionDescriptor[]) => void
  onPresentationChanged?: (state: PresentationDebugState) => void
  onTransitionChanged?: (change: ModelTransitionChange) => void
}
export type { AvatarAnimationName } from '../vrma'

export interface AvatarAnimationPlaybackOptions {
  stripRootTranslation?: boolean
  fadeDuration?: number
  loop?: THREE.AnimationActionLoopStyles
  repetitions?: number
  clampWhenFinished?: boolean
  /** 内部行为调度请求；低优先级自动动作不会打断显式高优先级动作。 */
  automatic?: boolean
}

/** Avatar 构图调试信息；仅供 UI 读取，不参与运行时修改。 */
export interface AvatarTransformDebugState {
  modelPosition: { x: number; y: number; z: number }
  modelRotation: { x: number; y: number; z: number }
  modelScale: { x: number; y: number; z: number }
  modelSize: { x: number; y: number; z: number }
  cameraPosition: { x: number; y: number; z: number }
  cameraTarget: { x: number; y: number; z: number }
}

export { listAnimations } from '../vrma'

export class AvatarViewer {
  private readonly three: ThreeRenderer
  private readonly loader: AvatarLoader
  /** 负责当前 VRM 的动作缓存和播放。 */
  private readonly animationManager: AnimationManager
  /** 负责当前 VRM 的加载、挂载和释放。 */
  private readonly modelManager: ModelManager
  /** 编排模型真实离场、加载和入场的状态机。 */
  private readonly transition: ModelTransitionController
  private readonly features: AvatarFeatureManager
  private readonly entrance: AvatarEntranceFeature
  private readonly expression: AvatarExpressionFeature
  private readonly onExpressionsChanged:
    | ((expressions: AvatarExpressionDescriptor[]) => void)
    | undefined
  private vrm: VRM | null = null
  private mixer: THREE.AnimationMixer | null = null
  private lipSyncPlayer: LipSyncPlayer | null = null
  private lipSyncTimeProvider: (() => number) | null = null
  /** 当前对话/语音基础动作；临时动作结束后恢复到它而非静态最后一帧。 */
  private baseAnimationName: AvatarAnimationName = 'idle'
  /** 当前显式动作；Dance/Response 等动作不会被 Talking 或 Idle 抢占。 */
  private activeBehavior: { name: string; priority: number } | null = null
  private pendingBaseAnimation: AvatarAnimationName | null = null
  private idleCycleTimer: number | null = null
  private idleCycleToken = 0
  private idleIndex = 0
  /** TTS 期间的基础动作标志；回应手势结束后必须回到 Talking 而非 Idle。 */
  private talkingActive = false
  private readonly idleAnimations = ['idleUtsuwa1', 'idleUtsuwa2', 'idleUtsuwa3', 'idleUtsuwa4', 'idleUtsuwa5']
  private disposed = false

  public constructor(
    container: HTMLElement,
    options: AvatarViewerOptions = {},
  ) {
    this.three = new ThreeRenderer(container, options)
    this.onExpressionsChanged = options.onExpressionsChanged
    this.loader = new AvatarLoader()
    this.animationManager = new AnimationManager(this.loader)
    this.modelManager = new ModelManager(this.three.scene, this.loader, {
      onBeforeUnload: (model) => {
        this.clearIdleCycle()
        this.activeBehavior = null
        this.pendingBaseAnimation = null
        this.talkingActive = false
        this.animationManager.detach()
        this.mixer?.stopAllAction()
        this.mixer?.uncacheRoot(model.vrm.scene)
        this.mixer = null
        this.vrm = null
        this.three.setAnimationMixer(null)
        this.three.setAnimationUpdater(null)
        this.expression.setExpressionManager(null)
      },
    })
    this.transition = new ModelTransitionController(
      {
        getCurrentModelId: () => this.modelManager.getCurrentModelId(),
        exitCurrent: () => this.exitCurrentModel(),
        unloadCurrent: () => this.modelManager.unloadCurrent(),
        loadModel: (modelId) => this.loadModelRuntime(modelId),
        enterCurrent: () => this.enterCurrentModel(),
      },
      options.onTransitionChanged,
    )
    const entranceOptions =
      typeof options.entrance === 'object'
        ? options.entrance
        : { enabled: options.entrance ?? true }
    this.entrance = AvatarEntranceFeature.create(
      (name, playbackOptions) => this.playAnimation(name, playbackOptions),
      entranceOptions,
    )
    this.expression = AvatarExpressionFeature.create({
      onStateChanged: options.onPresentationChanged,
    })
    this.features = new AvatarFeatureManager([
      AvatarShadowFeature.create({ enabled: options.shadow ?? true }),
      this.entrance,
      this.expression,
    ])
    this.features.init({
      scene: this.three.scene,
      renderer: this.three.renderer,
      camera: this.three.camera,
      getAvatarRoot: () => this.vrm?.scene ?? null,
      groundY: 0,
    })
    this.three.start()
  }

  /** 加载 Avatar；未传 URL 时使用注册表中的默认模型。 */
  public async load(modelIdOrUrl = DEFAULT_MODEL_ID): Promise<void> {
    try {
      await this.loadModelRuntime(modelIdOrUrl)
      await this.enterCurrentModel()
    } catch {
      // AvatarLoader has already logged the concrete failure reason.
    }
  }

  /** 播放指定动作，并停止当前正在播放的动作。 */
  public async playAnimation(
    name: AvatarAnimationName,
    options: AvatarAnimationPlaybackOptions = {},
  ): Promise<void> {
    if (!this.vrm || !this.mixer || this.disposed) return
    const definition = getAnimationDefinition(name)
    if (!definition) return
    const automatic = options.automatic === true
    const priority = this.getAnimationPriority(definition.category, name)
    if (automatic && this.activeBehavior && this.activeBehavior.priority > priority) {
      if (definition.category === 'base') this.pendingBaseAnimation = name
      return
    }
    if (!automatic && definition.category !== 'base') {
      this.activeBehavior = { name, priority }
    }

    // Base 动作是持续运行层（Idle 或 idle-talking）；记录它，供临时
    // response/pose/thinking 结束后的 Recover 阶段重新接管。
    if (definition?.category === 'base' && name !== 'talking') this.baseAnimationName = name

    try {
      await this.animationManager.play(name, options)
    } catch (error) {
      console.error(`Failed to play avatar animation: ${name}`, error)
    }
  }

  /**
   * 播放 TTS 期间的身体基础动作。
   *
   * 若 Registry 提供 face-to-face 的 idle-talking，则优先使用它；当前
   * Elara 资源没有该动作时安全回退普通循环 Idle，不伪造第二套 Runtime。
   */
  public playTalkingAnimation(): Promise<void> {
    this.clearIdleCycle()
    this.talkingActive = true
    // 当前 Utsuwa talking.vrma 含有转身/挥手轨道，不适合作为 Elara 的
    // 说话基础动作。暂时复用不转身的自然 Idle 片段，口型仍由 LipSync
    // 驱动；待取得许可清晰的 Talking.fbx/VRMA 后，只需替换此动作 ID。
    return this.playAnimation('idleUtsuwa3', {
      stripRootTranslation: true,
      loop: THREE.LoopRepeat,
      repetitions: Infinity,
      fadeDuration: 0.3,
      automatic: true,
    })
  }

  /** TTS 完成后的基础动作恢复入口；始终回到循环 Idle，而非停在 talking pose。 */
  public playIdleAnimation(): Promise<void> {
    this.talkingActive = false
    return this.playAnimation(this.idleAnimations[this.idleIndex] ?? 'idle', {
      stripRootTranslation: true,
      loop: THREE.LoopRepeat,
      repetitions: Infinity,
      fadeDuration: 1.2,
      automatic: true,
    })
      .then(() => this.scheduleIdleCycle())
  }

  /**
   * 主动取消当前动作并回到持续 Idle。
   *
   * AnimationManager.stop() 只负责停止 Mixer；这里补齐表现层清理与
   * Idle 重启，确保用户取消动作时不会停在最后一帧或冻结成静态 Pose。
   */
  public stopAnimation(preserveHighPriority = false): void {
    if (this.disposed || !this.vrm || !this.mixer) return
    if (preserveHighPriority && (this.activeBehavior?.priority ?? 0) >= 100) return
    this.activeBehavior = null
    this.pendingBaseAnimation = null
    this.talkingActive = false
    this.clearIdleCycle()
    this.expression.recoverToIdle()
    // 先请求基础动作接管；AnimationManager 会在新 Action 播放后再回收
    // 当前动作，避免主动取消时也短暂暴露 VRM 的原始姿势。
    void this.playAnimation(this.baseAnimationName, {
      stripRootTranslation: true,
      loop: THREE.LoopRepeat,
      repetitions: Infinity,
      automatic: true,
    })
  }

  public setEmotion(emotion: AvatarEmotion): void {
    this.expression.setEmotion(emotion)
  }

  public setMouth(mouth: AvatarMouth): void {
    this.expression.setMouth(mouth)
  }

  public setLipSyncWeights(weights: LipSyncWeights): void {
    this.expression.setLipSyncWeights(weights)
  }

  public setLipSyncPlayer(
    player: LipSyncPlayer | null,
    getCurrentTime: (() => number) | null = null,
  ): void {
    this.lipSyncPlayer = player
    this.lipSyncTimeProvider = getCurrentTime
    if (!player)
      this.expression.setLipSyncWeights({ aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 })
  }

  public blink(): void {
    this.expression.blink()
  }

  public blinkLeft(): void {
    this.expression.blinkLeft()
  }

  public blinkRight(): void {
    this.expression.blinkRight()
  }

  public clearEmotion(): void {
    this.expression.clearEmotion()
  }

  public setActionExpression(name: string | null): void {
    this.expression.setActionExpression(name)
  }

  public getPresentationDebugState(): PresentationDebugState {
    return this.expression.getDebugState()
  }

  public getAvailableExpressions(): AvatarExpressionDescriptor[] {
    return this.expression.getAvailableExpressions()
  }

  public toggleExpression(name: string): boolean {
    return this.expression.toggleExpression(name)
  }

  /** 返回当前模型管理状态，供切换控制器和 UI 读取。 */
  public getModelManager(): ModelManager {
    return this.modelManager
  }

  /** 切换到指定 Registry 模型；过渡期间重复请求会被忽略。 */
  public switchModel(modelId: string): Promise<void> {
    return this.transition.switchTo(modelId)
  }

  /** 返回模型切换状态机，供 UI 读取状态。 */
  public getModelTransitionController(): ModelTransitionController {
    return this.transition
  }

  /** 返回当前唯一 Three.js Renderer 的 Canvas，用于 Camera Mode 拍照。 */
  public getCanvas(): HTMLCanvasElement {
    return this.three.renderer.domElement
  }

  /** 返回当前模型与相机的构图参数，供调试面板实时展示。 */
  public getTransformDebugState(): AvatarTransformDebugState | null {
    const model = this.vrm?.scene
    if (!model) return null
    const bounds = new THREE.Box3().setFromObject(model)
    const size = bounds.getSize(new THREE.Vector3())
    const target = this.three.controls.target
    return {
      modelPosition: { x: model.position.x, y: model.position.y, z: model.position.z },
      modelRotation: { x: model.rotation.x, y: model.rotation.y, z: model.rotation.z },
      modelScale: { x: model.scale.x, y: model.scale.y, z: model.scale.z },
      modelSize: { x: size.x, y: size.y, z: size.z },
      cameraPosition: {
        x: this.three.camera.position.x,
        y: this.three.camera.position.y,
        z: this.three.camera.position.z,
      },
      cameraTarget: { x: target.x, y: target.y, z: target.z },
    }
  }

  /** 模型加载后直接播放循环 Idle，不执行入场移动。 */
  private async enterCurrentModel(): Promise<void> {
    if (!this.vrm || this.disposed) return
    this.baseAnimationName = 'idleUtsuwa1'
    this.talkingActive = false
    this.idleIndex = 0
    this.clearIdleCycle()
    await this.playAnimation('idleUtsuwa1', {
      stripRootTranslation: true,
      loop: THREE.LoopRepeat,
      repetitions: Infinity,
      fadeDuration: 0.3,
      automatic: true,
    })
    this.scheduleIdleCycle()
  }

  /** 模型切换时保持原地，不执行离场移动。 */
  private async exitCurrentModel(): Promise<void> {
    if (this.disposed) return
    this.entrance.resetForEntry()
  }

  /** 加载并初始化模型运行时，但不触发入场移动。 */
  private async loadModelRuntime(modelIdOrUrl: string): Promise<void> {
    const loaded = await this.modelManager.load(modelIdOrUrl)
    if (this.disposed) return
    const { vrm } = loaded
    this.vrm = vrm
    this.expression.setExpressionManager(vrm.expressionManager)
    this.onExpressionsChanged?.(this.expression.getAvailableExpressions())
    this.frameModel(vrm.scene)
    this.mixer = new THREE.AnimationMixer(vrm.scene)
    this.animationManager.attach(
      vrm,
      this.mixer,
      (name) => this.expression.setMotion(name),
      (name, phase) => this.handleAnimationLifecycle(name, phase),
    )
    this.expression.setMotion('idle')
    this.three.setAnimationMixer(this.mixer)
    this.three.setAnimationUpdater((deltaSeconds) => {
      if (this.vrm !== vrm || this.disposed) return
      vrm.update(deltaSeconds)
      if (this.lipSyncPlayer && this.lipSyncTimeProvider) {
        this.lipSyncPlayer.update(this.lipSyncTimeProvider())
        this.expression.setLipSyncWeights(this.lipSyncPlayer.getCurrentWeights())
      }
      this.features.update(deltaSeconds)
    })
  }

  private frameModel(model: THREE.Object3D): void {
    // 默认构图是产品视图基准，不随模型加载结果漂移；模型比例仍保持资源原值。
    model.position.set(0, -0, 0.01)
    model.rotation.set(0, 3.142, 0)
    model.scale.set(1, 1, 1)
    model.updateMatrixWorld(true)
    const target = new THREE.Vector3(-0.005, 1.232, -0.059)
    this.three.camera.position.set(-0.028, 1.532, 1.915)
    this.three.controls.target.copy(target)
    this.three.controls.minDistance = 1.9968
    this.three.controls.maxDistance = 8
    this.three.camera.near = 0.01
    this.three.camera.far = 1000
    this.three.camera.lookAt(target)
    this.three.controls.update()
    this.three.camera.updateProjectionMatrix()

  }

  /** 动作完成、被打断或异常时统一执行 Cleanup → Recover → Idle。 */
  private handleAnimationLifecycle(
    name: string,
    phase: 'finished' | 'error' | 'interrupted',
  ): void {
    if (this.disposed || !this.vrm) return
    if (this.activeBehavior?.name === name) this.activeBehavior = null
    if (name === 'idle' || name.startsWith('idleUtsuwa')) return
    this.expression.recoverToIdle()
    // 被新动作打断时只执行 Cleanup，不启动恢复动作；新动作随后会立即接管。
    // 这一步仍然必须清掉旧动作的临时 Expression，避免 A 的表情残留到 B。
    if (phase === 'interrupted') return
    if (phase === 'error') {
      console.warn(`Avatar action ${name} failed; recovered to idle.`)
    }
    const pending = this.pendingBaseAnimation
    this.pendingBaseAnimation = null
    const recoveryBase = this.talkingActive ? 'talking' : (pending ?? this.baseAnimationName)
    void this.playAnimation(recoveryBase, {
      stripRootTranslation: true,
      loop: THREE.LoopRepeat,
      repetitions: Infinity,
      fadeDuration: phase === 'finished' ? 0.12 : 0,
      automatic: true,
    })
  }

  /** Utsuwa 风格的低频 Idle 轮换：避免连续重复，并让每个动作完整循环 1～2 次。 */
  private scheduleIdleCycle(): void {
    this.clearIdleCycle()
    const duration = this.animationManager.getActiveAnimationDuration() ?? 6
    const token = ++this.idleCycleToken
    const delay = duration * (1 + Math.random()) * 1000
    this.idleCycleTimer = window.setTimeout(() => {
      this.idleCycleTimer = null
      if (this.disposed || token !== this.idleCycleToken || this.activeBehavior || this.talkingActive) return
      this.idleIndex = (this.idleIndex + 1 + Math.floor(Math.random() * Math.max(this.idleAnimations.length - 1, 1))) % this.idleAnimations.length
      void this.playAnimation(this.idleAnimations[this.idleIndex], {
        stripRootTranslation: true,
        loop: THREE.LoopRepeat,
        repetitions: Infinity,
        fadeDuration: 1.2,
        automatic: true,
      }).then(() => this.scheduleIdleCycle())
    }, Math.max(delay, 3000))
  }

  private clearIdleCycle(): void {
    this.idleCycleToken += 1
    if (this.idleCycleTimer !== null) {
      window.clearTimeout(this.idleCycleTimer)
      this.idleCycleTimer = null
    }
  }

  private getAnimationPriority(category: string, name: string): number {
    if (category === 'dance') return 100
    if (category === 'action' || category === 'pose' || category === 'response') return 80
    if (category === 'emotion' || name === 'thinking') return 60
    if (name === 'talking') return 40
    return 20
  }

  public dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.clearIdleCycle()
    this.animationManager.dispose()
    void this.modelManager.unloadCurrent()
    this.vrm = null
    this.mixer = null
    this.three.setAnimationMixer(null)
    this.three.setAnimationUpdater(null)
    this.lipSyncPlayer?.reset()
    this.lipSyncPlayer = null
    this.lipSyncTimeProvider = null
    this.features.dispose()
    this.transition.dispose()
    this.modelManager.dispose()
    this.three.dispose()
  }
}
