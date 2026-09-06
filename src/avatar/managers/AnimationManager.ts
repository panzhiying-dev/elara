import * as THREE from 'three'
import { VRM } from '@pixiv/three-vrm'
import type { VRMHumanBoneName } from '@pixiv/three-vrm-core'
import {
  createVRMAnimationClip,
  type VRMAnimation,
} from '@pixiv/three-vrm-animation'
import { AvatarLoader } from '../AvatarLoader'
import {
  getAnimationDefinition,
  type AvatarAnimationName,
} from '../../vrma'

/** 动画播放参数；用于控制淡入淡出、循环和根节点位移处理。 */
export interface AnimationPlaybackOptions {
  /** 是否移除 hips 的根位移轨道。 */
  stripRootTranslation?: boolean
  /** 与当前动作交叉淡化的时长（秒）。 */
  fadeDuration?: number
  /** Three.js 循环模式。 */
  loop?: THREE.AnimationActionLoopStyles
  /** 循环次数。 */
  repetitions?: number
  /** 非循环动作结束后是否保持最后一帧。 */
  clampWhenFinished?: boolean
}

/**
 * 动作生命周期通知阶段。
 *
 * finished/error 会进入 Viewer 的 Recover → Idle；interrupted 只清理旧动作，
 * 让新的动作请求继续接管，避免在切换竞态中错误启动 Idle。
 */
export type AnimationLifecyclePhase = 'finished' | 'error' | 'interrupted'

/**
 * 负责 VRMA 资源缓存、Clip/Action 创建及单 Mixer 动作切换。
 * AvatarViewer 只负责把当前 VRM 运行时交给本管理器，不再维护资源 URL 映射。
 */
export class AnimationManager {
  /** 复用的 VRM/VRMA 底层加载器。 */
  private readonly loader: AvatarLoader
  /** 按动作 ID 缓存已解析的 VRMA。 */
  private readonly animations = new Map<string, VRMAnimation>()
  /** 当前绑定的 VRM。 */
  private vrm: VRM | null = null
  /** 当前 VRM 对应的 AnimationMixer。 */
  private mixer: THREE.AnimationMixer | null = null
  /** 当前正在播放的动作。 */
  private activeAction: THREE.AnimationAction | null = null
  /** 播放动作时通知表现层更新 motion。 */
  private onMotionChanged: ((name: string) => void) | null = null
  /** 动作结束、异常或被替换时通知 Avatar Runtime 做恢复清理。 */
  private onActionLifecycle: ((name: string, phase: AnimationLifecyclePhase) => void) | null = null
  /** 递增请求序号，令被新动作替换的异步加载结果失效。 */
  private playRequestId = 0
  /** 正在等待 VRMA 加载的动作请求；用于避免旧动作结束时抢占新动作。 */
  private pendingPlayRequestId: number | null = null
  /** 当前动作对应的语义 ID，用于 finished 事件过滤。 */
  private activeAnimationName: string | null = null
  /** 临时动画诊断计时器。 */
  private diagnosticTimer: number | null = null
  /** 等待淡出完成后回收的旧动作；避免切换帧恢复 Mixer 原始姿势。 */
  private readonly pendingActionReleases = new Map<THREE.AnimationAction, number>()
  /** 管理器是否已释放。 */
  private disposed = false

  /** 创建动画管理器；底层加载仍复用现有 AvatarLoader。 */
  public constructor(loader: AvatarLoader) {
    this.loader = loader
  }

  /** 绑定当前 VRM 与 Mixer，后续动作将作用于该模型。 */
  public attach(
    vrm: VRM,
    mixer: THREE.AnimationMixer,
    onMotionChanged?: (name: string) => void,
    onActionLifecycle?: (name: string, phase: AnimationLifecyclePhase) => void,
  ): void {
    this.detach()
    this.disposed = false
    this.vrm = vrm
    this.mixer = mixer
    this.onMotionChanged = onMotionChanged ?? null
    this.onActionLifecycle = onActionLifecycle ?? null
    mixer.addEventListener('finished', this.handleMixerFinished)
  }

  /** 当前是否存在可播放的 VRM 运行时。 */
  public isAttached(): boolean {
    return this.vrm !== null && this.mixer !== null && !this.disposed
  }

  /** 返回当前动作片段时长；供低频 Idle 轮换使用，不暴露 Mixer 所有权。 */
  public getActiveAnimationDuration(): number | null {
    return this.activeAction?.getClip().duration ?? null
  }

  /** 播放指定动作；动作 URL 和循环默认值均来自 Animation Registry。 */
  public async play(
    name: AvatarAnimationName,
    options: AnimationPlaybackOptions = {},
  ): Promise<void> {
    const vrm = this.vrm
    const mixer = this.mixer
    if (!vrm || !mixer || this.disposed) return
    const requestId = ++this.playRequestId
    this.pendingPlayRequestId = requestId

    const definition = getAnimationDefinition(name)
    if (!definition) {
      console.error(`Avatar animation is not registered: ${name}`)
      this.pendingPlayRequestId = null
      if (name !== 'idle') this.onActionLifecycle?.(name, 'error')
      return
    }

    try {
      let animation = this.animations.get(definition.id)
      if (!animation) {
        animation = await this.loader.loadAnimation(definition.url)
        if (this.disposed || this.vrm !== vrm || this.mixer !== mixer || requestId !== this.playRequestId) return
        this.animations.set(definition.id, animation)
      }
      if (this.disposed || this.vrm !== vrm || this.mixer !== mixer || requestId !== this.playRequestId) return

      const clip = createVRMAnimationClip(animation, vrm)
      if (options.stripRootTranslation) this.stripRootTranslation(clip, vrm)

      const previousAction = this.activeAction
      const previousName = this.activeAnimationName
      const fadeDuration = Math.max(options.fadeDuration ?? 0, 0)
      const action = mixer.clipAction(clip)
      // 同一个 AnimationAction 会被 Three.js 复用，必须每次显式取消上一次的 clamp 状态。
      action.clampWhenFinished = options.clampWhenFinished ?? false
      action.setLoop(
        options.loop ?? (definition.loop ? THREE.LoopRepeat : THREE.LoopOnce),
        options.repetitions ?? (definition.loop ? Infinity : 1),
      )
      action.reset()
      // 无淡化请求时让新 Action 立即以满权重接管；旧 Action 仍延迟一帧
      // 回收，避免 releaseAction() 在新 Action 参与渲染前恢复原始姿势。
      const handoffDuration = Math.max(fadeDuration, 1 / 60)
      if (fadeDuration > 0) action.fadeIn(handoffDuration)
      action.play()
      // 先让新 Action 接管，再淡出并延迟回收旧 Action。这样 releaseAction()
      // 不会在两个 Action 之间暴露 VRM 的原始骨骼姿势。
      this.activeAction = action
      this.activeAnimationName = definition.id
      this.pendingPlayRequestId = null
      if (previousAction && previousAction !== action) {
        if (fadeDuration > 0) previousAction.fadeOut(handoffDuration)
        this.scheduleActionRelease(previousAction, mixer, handoffDuration)
        if (previousName && previousName !== 'idle') this.onActionLifecycle?.(previousName, 'interrupted')
      }
      console.info('[AnimationDiagnostics] mixer/action', {
        mixerIsCurrent: this.mixer === mixer,
        mixerRoot: mixer.getRoot(),
        action,
        enabled: action.enabled,
        paused: action.paused,
        time: action.time,
        weight: action.weight,
        timeScale: action.timeScale,
        mixerTime: mixer.time,
      })
      this.onMotionChanged?.(name)
      this.startDiagnostics(name, action, vrm, mixer)
    } catch (error) {
      console.error(`Failed to play avatar animation: ${name}`, error)
      // 旧动作的异步加载失败不能覆盖更新后的动作请求；只有仍是当前请求
      // 才能触发 Recover → Idle，避免错误回调打断新动作。
      if (
        this.pendingPlayRequestId === requestId &&
        this.vrm === vrm &&
        this.mixer === mixer &&
        !this.disposed
      ) {
        this.pendingPlayRequestId = null
        this.onActionLifecycle?.(definition.id, 'error')
      }
    }
  }

  /** 停止当前动作并清除其 Mixer 引用；主动停止由上层负责随后恢复 Idle。 */
  public stop(): void {
    this.playRequestId += 1
    this.pendingPlayRequestId = null
    const name = this.activeAnimationName
    if (this.activeAction && this.mixer) {
      this.releaseAction(this.activeAction, this.mixer)
    }
    this.activeAction = null
    this.activeAnimationName = null
    if (name) this.onActionLifecycle?.(name, 'interrupted')
  }

  /** 解除当前 VRM/Mixer 绑定，但保留已加载动作缓存供同一实例复用。 */
  public detach(): void {
    this.clearDiagnosticTimer()
    this.playRequestId += 1
    this.pendingPlayRequestId = null
    if (this.mixer) this.mixer.removeEventListener('finished', this.handleMixerFinished)
    if (this.mixer) {
      this.pendingActionReleases.forEach((_timer, action) => this.releaseAction(action, this.mixer as THREE.AnimationMixer))
      this.pendingActionReleases.clear()
      if (this.activeAction) {
        this.releaseAction(this.activeAction, this.mixer)
      }
    }
    this.activeAction = null
    this.activeAnimationName = null
    this.vrm = null
    this.mixer = null
    this.onMotionChanged = null
    this.onActionLifecycle = null
  }

  /** 释放动作缓存、计时器和当前运行时引用。 */
  public dispose(): void {
    this.disposed = true
    this.detach()
    this.animations.clear()
  }

  /** 移除 VRMA 中 hips 的位移轨道，避免与 AvatarRoot 空间移动叠加。 */
  private stripRootTranslation(clip: THREE.AnimationClip, vrm: VRM): void {
    const rootNames = new Set(
      [
        vrm.humanoid.getNormalizedBoneNode('hips')?.name,
        vrm.humanoid.getRawBoneNode('hips')?.name,
      ].filter((value): value is string => value !== undefined),
    )
    clip.tracks = clip.tracks.filter((track) => {
      const [targetName, property] = track.name.split('.')
      return !(property === 'position' && rootNames.has(targetName))
    })
  }

  /** 延迟采样动作状态，保留现有项目的动画诊断能力。 */
  private startDiagnostics(
    name: string,
    action: THREE.AnimationAction,
    vrm: VRM,
    mixer: THREE.AnimationMixer,
  ): void {
    this.clearDiagnosticTimer()
    const diagnosticBones = (
      ['hips', 'leftUpperArm', 'rightUpperArm'] as VRMHumanBoneName[]
    ).map((boneName) => ({
      boneName,
      normalized: vrm.humanoid.getNormalizedBoneNode(boneName) ?? null,
      raw: vrm.humanoid.getRawBoneNode(boneName) ?? null,
    }))
    const beforeBoneRotations = diagnosticBones.map((bone) => ({
      normalized: bone.normalized?.quaternion.clone(),
      raw: bone.raw?.quaternion.clone(),
    }))
    this.diagnosticTimer = window.setTimeout(() => {
      this.diagnosticTimer = null
      if (this.disposed || this.vrm !== vrm || this.mixer !== mixer) return
      console.info('[AnimationDiagnostics] one-second sample', {
        name,
        actionTime: action.time,
        mixerTime: mixer.time,
        actionStillActive: this.activeAction === action,
        boneSamples: diagnosticBones.map((bone, index) => ({
          boneName: bone.boneName,
          normalizedChanged: !beforeBoneRotations[index].normalized?.equals(
            bone.normalized?.quaternion ?? new THREE.Quaternion(),
          ),
          rawChanged: !beforeBoneRotations[index].raw?.equals(
            bone.raw?.quaternion ?? new THREE.Quaternion(),
          ),
        })),
      })
    }, 1000)
  }

  /** 清理尚未触发的诊断计时器。 */
  private clearDiagnosticTimer(): void {
    if (this.diagnosticTimer === null) return
    window.clearTimeout(this.diagnosticTimer)
    this.diagnosticTimer = null
  }

  /**
   * 释放已结束或被替换的动作。
   *
   * Mixer 会缓存 clipAction；仅 stop/reset 不会解除缓存，连续动作会积累
   * 无效 Action/Clip 引用。统一在这里停止、重置并从当前 Mixer 中回收。
   */
  private releaseAction(
    action: THREE.AnimationAction,
    mixer: THREE.AnimationMixer,
  ): void {
    const timer = this.pendingActionReleases.get(action)
    if (timer !== undefined) {
      window.clearTimeout(timer)
      this.pendingActionReleases.delete(action)
    }
    const activeAction = this.activeAction
    if (
      activeAction &&
      activeAction !== action &&
      this.mixer === mixer
    ) {
      // 定时器可能早于下一次 RAF 触发；确保接管动作不会仍处于淡入的
      // 零权重起点，否则旧 Action 释放时仍可能短暂露出原始姿势。
      activeAction.stopFading()
      activeAction.enabled = true
      activeAction.paused = false
      activeAction.weight = 1
    }
    const clip = action.getClip()
    action.stop()
    action.reset()
    mixer.uncacheAction(clip, mixer.getRoot())
    mixer.uncacheClip(clip)
    // stop() 会把绑定恢复到原始值；若新 Action 已接管，立即重新应用其
    // 当前帧，避免定时回收旧 Action 时在下一次 RAF 前出现静态姿势。
    if (
      activeAction &&
      activeAction !== action &&
      this.mixer === mixer &&
      activeAction.enabled &&
      !activeAction.paused
    ) {
      mixer.update(0)
    }
  }

  /** 处理 LoopOnce 动作结束，清空当前动作占用并交给 AvatarViewer 恢复 Idle。 */
  private readonly handleMixerFinished = (event: { action: THREE.AnimationAction }): void => {
    if (event.action !== this.activeAction) return
    const finishedAction = event.action
    const name = this.activeAnimationName
    if (!name) return
    this.clearDiagnosticTimer()
    const mixer = this.mixer
    // Three.js 已在 dispatch finished 前将 LoopOnce Action 设为 disabled。
    // 先冻结在最后一帧，直到基础 Action 完成安装，避免恢复原始 Pose。
    finishedAction.enabled = true
    finishedAction.paused = true
    if (this.pendingPlayRequestId !== null) {
      // 新动作仍在异步加载时，旧动作可能先自然结束；先清理旧动作的
      // 临时表情，但不启动 Idle，避免与即将安装的新动作发生竞争。
      this.onActionLifecycle?.(name, 'interrupted')
    } else {
      this.onActionLifecycle?.(name, 'finished')
    }
    // 回调通常会同步登记新的 playRequest；若没有任何恢复请求，才在交接
    // 窗口后清理已冻结的动作。存在异步加载时继续保留最后一帧，避免闪回。
    if (this.activeAction === finishedAction && this.pendingPlayRequestId === null) {
      this.activeAction = null
      this.activeAnimationName = null
      if (mixer) this.scheduleActionRelease(finishedAction, mixer, 1 / 60)
    }
  }

  /** 延迟回收已淡出的动作，确保至少经过一次新动作参与的渲染帧。 */
  private scheduleActionRelease(
    action: THREE.AnimationAction,
    mixer: THREE.AnimationMixer,
    delaySeconds: number,
  ): void {
    const previousTimer = this.pendingActionReleases.get(action)
    if (previousTimer !== undefined) window.clearTimeout(previousTimer)
    const timer = window.setTimeout(() => {
      this.pendingActionReleases.delete(action)
      if (this.disposed || this.mixer !== mixer || this.activeAction === action) return
      this.releaseAction(action, mixer)
    }, Math.max(delaySeconds, 1 / 60) * 1000)
    this.pendingActionReleases.set(action, timer)
  }
}
