/** 表现层的稳定性参数；运行时状态由 Presentation Controller 持有。 */
export interface PresentationConfig {
  emotionFadeDuration: number
  emotionMinDuration: number
  blinkMinInterval: number
  blinkMaxInterval: number
  blinkDuration: number
  doubleBlinkChance: number
  doubleBlinkDelayMin: number
  doubleBlinkDelayMax: number
  microExpressionMinInterval: number
  microExpressionMaxInterval: number
  microExpressionMaxDelta: number
  microExpressionTransitionSpeed: number
}

export const DEFAULT_PRESENTATION_CONFIG: PresentationConfig = {
  emotionFadeDuration: 0.35,
  emotionMinDuration: 2,
  blinkMinInterval: 1.8,
  blinkMaxInterval: 4,
  blinkDuration: 0.14,
  doubleBlinkChance: 0.1,
  doubleBlinkDelayMin: 0.2,
  doubleBlinkDelayMax: 0.4,
  microExpressionMinInterval: 3,
  microExpressionMaxInterval: 7,
  microExpressionMaxDelta: 0.08,
  microExpressionTransitionSpeed: 3,
}
