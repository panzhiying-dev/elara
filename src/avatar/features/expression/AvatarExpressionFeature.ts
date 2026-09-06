import type { VRMExpressionManager } from '@pixiv/three-vrm-core'
import type { AvatarFeature, AvatarFeatureContext } from '../../AvatarFeature'
import {
  AvatarPresentationController,
  type AvatarPresentationControllerOptions,
  type PresentationDebugState,
  type PresentationEmotion,
  type PresentationMouth,
} from './AvatarPresentationController'
import type { LipSyncWeights } from '../../../lipsync/LipSyncTypes'

export type AvatarEmotion = PresentationEmotion
export type AvatarMouth = PresentationMouth
export type AvatarExpressionCategory = 'Emotion' | 'Blink' | 'Mouth' | 'Other'

export interface AvatarExpressionDescriptor { name: string; category: AvatarExpressionCategory }
export interface AvatarExpressionFeatureOptions extends AvatarPresentationControllerOptions {
  enabled?: boolean
  /** 兼容旧 API：数值越大，情绪过渡越快。 */
  transitionSpeed?: number
  /** 兼容旧 API：单次眨眼时长（秒）。 */
  blinkDuration?: number
}

/** 表现层适配器：保持现有 Explorer API，并把最终权重交给 Presentation Controller。 */
export class AvatarExpressionFeature implements AvatarFeature {
  private readonly controller: AvatarPresentationController
  private context: AvatarFeatureContext | null = null
  private manager: VRMExpressionManager | null = null
  private enabled: boolean

  private constructor(options: AvatarExpressionFeatureOptions = {}) {
    const config = {
      ...options.config,
      ...(options.transitionSpeed !== undefined
        ? { emotionFadeDuration: 1 / Math.max(options.transitionSpeed, 0.001) }
        : {}),
      ...(options.blinkDuration !== undefined ? { blinkDuration: options.blinkDuration } : {}),
    }
    this.controller = new AvatarPresentationController({ ...options, config })
    this.enabled = options.enabled ?? true
  }

  public static create(options: AvatarExpressionFeatureOptions = {}): AvatarExpressionFeature { return new AvatarExpressionFeature(options) }
  public init(context: AvatarFeatureContext): void { if (!this.context) this.context = context }
  public setExpressionManager(manager: VRMExpressionManager | null | undefined): void { this.manager = manager ?? null; this.controller.setExpressionManager(this.manager) }
  public setMotion(motion: string): void { this.controller.setMotion(motion) }
  /** 清除动作临时表情并把表现层交还给 Idle 基础状态。 */
  public recoverToIdle(): void { this.controller.recoverToIdle() }
  public setEmotion(emotion: AvatarEmotion): void { this.controller.setEmotion(emotion) }
  public setMouth(mouth: AvatarMouth): void { this.controller.setMouth(mouth) }
  public setLipSyncWeights(weights: LipSyncWeights): void { this.controller.setLipSyncWeights(weights) }
  public blink(): void { this.controller.requestBlink('blink') }
  public blinkLeft(): void { this.controller.requestBlink('blinkLeft') }
  public blinkRight(): void { this.controller.requestBlink('blinkRight') }
  public clearEmotion(): void { this.controller.clearEmotion() }
  public setActionExpression(name: string | null): void { this.controller.setActionExpression(name) }
  public update(deltaSeconds: number): void { if (this.enabled) this.controller.update(deltaSeconds) }
  public setEnabled(enabled: boolean): void { this.enabled = enabled; this.controller.setExpressionManager(enabled ? this.manager : null) }
  public dispose(): void { this.controller.dispose(); this.manager = null; this.context = null }
  public getDebugState(): PresentationDebugState { return this.controller.getDebugState() }

  /** 返回运行时真正注册且有 bind 的 Expression。 */
  public getAvailableExpressions(): AvatarExpressionDescriptor[] {
    if (!this.manager) return []
    const blinkNames = new Set(this.manager.blinkExpressionNames.map((name) => name.toLowerCase()))
    const mouthNames = new Set(this.manager.mouthExpressionNames.map((name) => name.toLowerCase()))
    return this.manager.expressions.filter((expression) => expression.binds.length > 0).map((expression) => {
      const lowerName = expression.expressionName.toLowerCase()
      const category: AvatarExpressionCategory = blinkNames.has(lowerName) || lowerName.includes('blink')
        ? 'Blink'
        : mouthNames.has(lowerName) || ['a', 'i', 'u', 'e', 'o', 'aa', 'ih', 'ou', 'ee', 'oh'].includes(lowerName)
          ? 'Mouth'
          : ['neutral', 'happy', 'angry', 'sad', 'relaxed', 'surprised', 'fun', 'joy', 'sorrow', 'unknown'].includes(lowerName)
            ? 'Emotion'
            : 'Other'
      return { name: expression.expressionName, category }
    }).sort((left, right) => left.name.localeCompare(right.name))
  }

  public toggleExpression(name: string): boolean { return this.controller.toggleExpression(name) }
}
