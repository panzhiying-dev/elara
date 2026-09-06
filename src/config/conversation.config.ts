/** 对话阶段的时间策略；集中管理 Thinking 延迟，避免散落魔法数字。 */
export interface ConversationPresentationConfig {
  /** 请求超过该时长仍未收到回复时，才允许进入 Thinking。 */
  thinkingTriggerDelayMs: number
  /** 无语义标注时，Talking 最少间隔多少个句子才允许一次回应手势。 */
  talkingGestureMinChunks: number
  /** 无语义标注时，Talking 最多间隔多少个句子才触发一次回应手势。 */
  talkingGestureMaxChunks: number
}

/** 默认 2 秒内保持自然 Idle，避免每次发送都机械播放 Thinking。 */
export const DEFAULT_CONVERSATION_PRESENTATION_CONFIG: ConversationPresentationConfig = {
  thinkingTriggerDelayMs: 2000,
  talkingGestureMinChunks: 2,
  talkingGestureMaxChunks: 5,
}
