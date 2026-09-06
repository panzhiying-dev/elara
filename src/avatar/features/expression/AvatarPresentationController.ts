import type { VRMExpressionManager } from '@pixiv/three-vrm-core'
import {
  DEFAULT_PRESENTATION_CONFIG,
  type PresentationConfig,
} from '../../../config/presentation.config'
import type { LipSyncWeights } from '../../../lipsync/LipSyncTypes'

export type PresentationEmotion =
  | 'neutral'
  | 'happy'
  | 'angry'
  | 'sad'
  | 'relaxed'
  | 'surprised'
export type PresentationMouth = 'none' | 'A' | 'I' | 'U' | 'E' | 'O'
export type PresentationBlink = 'blink' | 'blinkLeft' | 'blinkRight'

export interface PresentationDebugState {
  motion: string
  emotion: PresentationEmotion
  emotionSource: 'Explicit' | 'MotionDefault' | 'Neutral'
  blink: 'Ready' | 'CoolingDown' | 'Active'
  mouth: PresentationMouth
  microExpression: 'Idle' | 'Active'
  actionExpression: string | null
  conflict: string | null
  resolvedExpressions: Readonly<Record<string, number>>
}

export interface AvatarPresentationControllerOptions {
  config?: Partial<PresentationConfig>
  onStateChanged?: (state: PresentationDebugState) => void
}

const EMOTIONS: readonly PresentationEmotion[] = [
  'neutral',
  'happy',
  'angry',
  'sad',
  'relaxed',
  'surprised',
]
const MOUTH_MAP: Record<Exclude<PresentationMouth, 'none'>, string> = {
  A: 'aa', I: 'ih', U: 'ou', E: 'ee', O: 'oh',
}
const MOTION_DEFAULTS: Record<string, PresentationEmotion> = {
  greeting: 'happy',
  peaceSign: 'happy',
  spin: 'happy',
  SambaDancing: 'happy',
  thinking: 'relaxed',
  talking: 'relaxed',
}
const ACTION_OVERRIDES: Record<string, PresentationEmotion> = {
  greeting: 'happy',
  peaceSign: 'happy',
}

/** 负责把各表现层状态解析为 VRM 权重；只有权重变化时才写入 VRM。 */
export class AvatarPresentationController {
  private readonly config: PresentationConfig
  private readonly onStateChanged: ((state: PresentationDebugState) => void) | undefined
  private manager: VRMExpressionManager | null = null
  private motion = 'idle'
  private explicitEmotion: PresentationEmotion | null = null
  private actionExpression: string | null = null
  private activeEmotion: PresentationEmotion = 'neutral'
  private emotionElapsed = 0
  private emotionWeights: Record<PresentationEmotion, number> = {
    neutral: 1, happy: 0, angry: 0, sad: 0, relaxed: 0, surprised: 0,
  }
  private mouth: PresentationMouth = 'none'
  private lipSyncWeights: LipSyncWeights = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 }
  private blinkName: PresentationBlink | null = null
  private blinkElapsed = 0
  private nextBlinkAt = 3
  private pendingDoubleBlink = false
  private microElapsed = 0
  private nextMicroAt: number
  private microActive = false
  private microDelta = 0
  private microOffset = 0
  private readonly explorerWeights = new Map<string, number>()
  private readonly appliedWeights = new Map<string, number>()
  private lastDebugSignature = ''

  public constructor(options: AvatarPresentationControllerOptions = {}) {
    this.config = { ...DEFAULT_PRESENTATION_CONFIG, ...options.config }
    this.onStateChanged = options.onStateChanged
    this.nextBlinkAt = this.randomBetween(this.config.blinkMinInterval, this.config.blinkMaxInterval)
    this.nextMicroAt = this.randomBetween(this.config.microExpressionMinInterval, this.config.microExpressionMaxInterval)
  }

  public setExpressionManager(manager: VRMExpressionManager | null | undefined): void {
    if (manager === null || manager === undefined) {
      this.appliedWeights.forEach((_weight, name) => this.manager?.setValue(name, 0))
    }
    this.manager = manager ?? null
    this.resetBlinkTiming()
    this.appliedWeights.clear()
    this.applyResolvedWeights()
  }

  /**
   * 更新当前动作语义，并仅写入动作层默认表情。
   *
   * 这里不直接修改 VRM 权重；实际合成由 update() 的 Resolver 完成，
   * 因而动作结束时可以只清掉 actionExpression 而保留显式基础情绪。
   */
  public setMotion(motion: string): void {
    if (this.motion === motion && this.actionExpression === (ACTION_OVERRIDES[motion] ?? null)) return
    this.motion = motion
    this.actionExpression = ACTION_OVERRIDES[motion] ?? null
    if (this.explicitEmotion === null) this.emotionElapsed = 0
    this.emitDebugState()
  }

  /** 清理动作层并恢复基础表情与自动眨眼，供动作结束/异常恢复使用。 */
  public recoverToIdle(): void {
    this.motion = 'idle'
    this.actionExpression = null
    this.activeEmotion = this.explicitEmotion ?? 'neutral'
    this.emotionElapsed = 0
    EMOTIONS.forEach((emotion) => {
      this.emotionWeights[emotion] = emotion === this.activeEmotion ? 1 : 0
    })
    this.resetBlinkTiming()
    this.applyResolvedWeights()
    this.emitDebugState()
  }

  public setEmotion(emotion: PresentationEmotion): void {
    if (this.explicitEmotion === emotion) return
    this.explicitEmotion = emotion
    this.emotionElapsed = 0
    this.explorerWeights.clear()
    this.emitDebugState()
  }

  public clearEmotion(): void {
    if (this.explicitEmotion === null) return
    this.explicitEmotion = null
    this.emotionElapsed = 0
    this.emitDebugState()
  }

  /** 设置只在当前动作上下文有效的临时 Expression。 */
  public setActionExpression(name: string | null): void {
    if (this.actionExpression === name) return
    this.actionExpression = name
    this.emitDebugState()
  }

  public setMouth(mouth: PresentationMouth): void {
    if (this.mouth === mouth) return
    this.mouth = mouth
    this.explorerWeights.clear()
    this.emitDebugState()
  }

  public setLipSyncWeights(weights: LipSyncWeights): void {
    this.lipSyncWeights = { ...weights }
    this.applyResolvedWeights()
    this.emitDebugState()
  }

  public requestBlink(name: PresentationBlink = 'blink'): void {
    if (this.isBlinkBlocked()) return
    if (this.blinkName === name) return
    this.blinkName = name
    this.blinkElapsed = 0
    this.pendingDoubleBlink = false
    this.nextBlinkAt = 0
    this.emitDebugState()
  }

  public toggleExpression(name: string): boolean {
    const actualName = this.resolveName(name)
    if (!actualName) return false
    const lowerName = actualName.toLowerCase()
    const current = this.explorerWeights.get(actualName) ?? this.manager?.getValue(actualName) ?? 0
    const enabled = current <= 0.5
    if (enabled && EMOTIONS.includes(actualName as PresentationEmotion)) {
      this.explorerWeights.forEach((_value, key) => {
        if (EMOTIONS.includes(key as PresentationEmotion)) this.explorerWeights.set(key, 0)
      })
    }
    if (enabled && (lowerName === 'blink' || lowerName === 'blinkleft' || lowerName === 'blinkright')) {
      this.explorerWeights.forEach((_value, key) => {
        if (['blink', 'blinkleft', 'blinkright'].includes(key.toLowerCase())) this.explorerWeights.set(key, 0)
      })
    }
    this.explorerWeights.set(actualName, enabled ? 1 : 0)
    this.applyResolvedWeights()
    this.emitDebugState()
    return enabled
  }

  public update(deltaSeconds: number): void {
    if (!this.manager || deltaSeconds <= 0) return
    this.emotionElapsed += deltaSeconds
    this.microElapsed += deltaSeconds
    const targetEmotion = this.explicitEmotion ?? MOTION_DEFAULTS[this.motion] ?? 'neutral'
    if (targetEmotion !== this.activeEmotion && this.emotionElapsed >= this.config.emotionMinDuration) {
      this.activeEmotion = targetEmotion
      this.emotionElapsed = 0
    }
    const emotionInterpolation = Math.min(deltaSeconds / Math.max(this.config.emotionFadeDuration, 0.001), 1)
    EMOTIONS.forEach((emotion) => {
      const target = emotion === this.activeEmotion ? 1 : 0
      this.emotionWeights[emotion] += (target - this.emotionWeights[emotion]) * emotionInterpolation
      if (Math.abs(target - this.emotionWeights[emotion]) < 0.001) {
        this.emotionWeights[emotion] = target
      }
    })

    if (this.blinkName !== null) {
      this.blinkElapsed += deltaSeconds
      if (this.blinkElapsed >= this.config.blinkDuration) {
        this.blinkName = null
        this.blinkElapsed = 0
        if (Math.random() < this.config.doubleBlinkChance) {
          this.pendingDoubleBlink = true
          this.nextBlinkAt = this.randomBetween(this.config.doubleBlinkDelayMin, this.config.doubleBlinkDelayMax)
        } else {
          this.pendingDoubleBlink = false
          this.nextBlinkAt = this.randomBetween(this.config.blinkMinInterval, this.config.blinkMaxInterval)
        }
      }
    } else {
      this.nextBlinkAt -= deltaSeconds
      if (this.nextBlinkAt <= 0 && !this.isBlinkBlocked()) {
        this.blinkName = 'blink'
        this.blinkElapsed = 0
        this.pendingDoubleBlink = false
      }
    }

    if (!this.microActive && this.microElapsed >= this.nextMicroAt) {
      this.microActive = true
      this.microElapsed = 0
      this.microDelta = this.randomBetween(-this.config.microExpressionMaxDelta, this.config.microExpressionMaxDelta)
    } else if (this.microActive && this.microElapsed >= 0.8) {
      this.microActive = false
      this.microElapsed = 0
      this.microDelta = 0
      this.nextMicroAt = this.randomBetween(this.config.microExpressionMinInterval, this.config.microExpressionMaxInterval)
    }
    const microInterpolation = Math.min(
      deltaSeconds * this.config.microExpressionTransitionSpeed,
      1,
    )
    const microTarget = this.microActive ? this.microDelta : 0
    this.microOffset += (microTarget - this.microOffset) * microInterpolation
    if (Math.abs(microTarget - this.microOffset) < 0.001) this.microOffset = microTarget
    this.applyResolvedWeights()
    this.emitDebugState()
  }

  public getDebugState(): PresentationDebugState {
    const source: PresentationDebugState['emotionSource'] = this.explicitEmotion
      ? 'Explicit'
      : MOTION_DEFAULTS[this.motion]
        ? 'MotionDefault'
        : 'Neutral'
    const resolvedExpressions: Record<string, number> = {}
    this.appliedWeights.forEach((weight, name) => { if (weight > 0.001) resolvedExpressions[name] = weight })
    return {
      motion: this.motion,
      emotion: this.activeEmotion,
      emotionSource: source,
      blink: this.blinkName ? 'Active' : this.nextBlinkAt < this.config.blinkMinInterval ? 'CoolingDown' : 'Ready',
      mouth: this.mouth,
      microExpression: this.microActive ? 'Active' : 'Idle',
      actionExpression: this.actionExpression,
      conflict: this.getConflictDescription(),
      resolvedExpressions,
    }
  }

  public dispose(): void {
    this.appliedWeights.forEach((_weight, name) => this.writeValue(name, 0))
    this.explorerWeights.clear()
    this.manager = null
  }

  private applyResolvedWeights(): void {
    if (!this.manager) return
    const resolved = new Map<string, number>()
    const explorerEmotion = EMOTIONS.find((emotion) => (this.explorerWeights.get(emotion) ?? 0) > 0)
    EMOTIONS.forEach((emotion) => {
      const micro = emotion === this.activeEmotion ? this.microOffset : 0
      const baseWeight = explorerEmotion ? (emotion === explorerEmotion ? 1 : 0) : this.emotionWeights[emotion] + micro
      resolved.set(emotion, Math.max(0, Math.min(1, baseWeight)))
    })
    const blinkOverride = ['blink', 'blinkLeft', 'blinkRight'].find((name) => (this.explorerWeights.get(name) ?? 0) > 0)
    if (blinkOverride) resolved.set(blinkOverride, (this.explorerWeights.get(blinkOverride) ?? 0) * this.getBlinkConflictFactor())
    else if (this.blinkName && !this.isBlinkBlocked()) {
      const half = this.config.blinkDuration * 0.5
      const weight = this.blinkElapsed < half ? this.blinkElapsed / half : 1 - (this.blinkElapsed - half) / half
      resolved.set(this.blinkName, Math.max(0, Math.min(1, weight * this.getBlinkConflictFactor())))
    }
    const mouthExpression = this.mouth === 'none' ? null : MOUTH_MAP[this.mouth]
    ;['aa', 'ih', 'ou', 'ee', 'oh'].forEach((name) => {
      const lipSyncWeight = this.lipSyncWeights[name as keyof LipSyncWeights]
      resolved.set(name, mouthExpression ? (name === mouthExpression ? 1 : 0) : Math.max(0, Math.min(1, lipSyncWeight)))
    })
    if (this.explicitEmotion === null && this.actionExpression && EMOTIONS.includes(this.actionExpression as PresentationEmotion)) {
      EMOTIONS.forEach((emotion) => resolved.set(emotion, emotion === this.actionExpression ? 1 : 0))
    } else if (this.explicitEmotion === null && this.actionExpression) {
      resolved.set(this.actionExpression, 1)
    }
    this.explorerWeights.forEach((weight, name) => resolved.set(name, weight))
    this.appliedWeights.forEach((_weight, name) => {
      if (!resolved.has(name)) resolved.set(name, 0)
    })
    resolved.forEach((weight, name) => this.writeValue(name, weight))
  }

  private writeValue(name: string, weight: number): void {
    const actualName = this.resolveName(name)
    if (!actualName) return
    const value = Math.max(0, Math.min(1, weight))
    if (this.appliedWeights.get(actualName) === value) return
    this.manager?.setValue(actualName, value)
    this.appliedWeights.set(actualName, value)
  }

  private resolveName(name: string): string | null {
    if (!this.manager) return null
    if (this.manager.getExpression(name)) return name
    return Object.keys(this.manager.expressionMap).find((registered) => registered.toLowerCase() === name.toLowerCase()) ?? null
  }

  private emitDebugState(): void {
    const state = this.getDebugState()
    const signature = JSON.stringify(state)
    if (signature === this.lastDebugSignature) return
    this.lastDebugSignature = signature
    this.onStateChanged?.(state)
  }

  private getConflictDescription(): string | null {
    if (this.isBlinkBlocked()) return `${this.activeEmotion} blocks Blink`
    if (this.blinkName && this.actionExpression?.toLowerCase().includes('blink')) return 'Action override and blink'
    if (this.blinkName && this.explorerWeights.get('blink') === 1) return 'Manual blink overrides scheduler'
    return null
  }

  private isBlinkBlocked(): boolean {
    const emotion = this.manager?.getExpression(this.activeEmotion)
    const action = this.actionExpression ? this.manager?.getExpression(this.actionExpression) : null
    // EyesClosed/Blink 这类动作表达式本身已经接管眼睛；动作期间暂停调度器，
    // 结束后 recoverToIdle() 会清空 actionExpression 并重新安排随机眨眼。
    const actionName = this.actionExpression?.toLowerCase() ?? ''
    if (actionName.includes('blink') || (actionName.includes('eye') && actionName.includes('close'))) {
      return true
    }
    return emotion?.overrideBlink === 'block' || action?.overrideBlink === 'block'
  }

  private getBlinkConflictFactor(): number {
    // VRM 0.x 未提供逐帧眼睛开合度；Happy 只适度降低 Blink，避免长期不眨眼。
    const happyWeight = this.explicitEmotion === 'happy' || (this.explicitEmotion === null && this.actionExpression === 'happy')
      ? 1
      : this.emotionWeights.happy
    return happyWeight > 0.85 ? 0.55 : 1
  }

  private resetBlinkTiming(): void {
    this.blinkName = null
    this.blinkElapsed = 0
    this.pendingDoubleBlink = false
    this.nextBlinkAt = this.randomBetween(this.config.blinkMinInterval, this.config.blinkMaxInterval)
  }

  private randomBetween(min: number, max: number): number {
    return min + Math.random() * Math.max(max - min, 0)
  }
}
