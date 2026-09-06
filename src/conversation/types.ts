/** Conversation UI 中的消息角色。 */
export type ConversationMessageRole = 'user' | 'assistant'

/** 前端展示的消息。 */
export interface ConversationMessage {
  /** 前端或后端消息 ID。 */
  id: string
  /** 消息角色。 */
  role: ConversationMessageRole
  /** 消息文本。 */
  content: string
  /** 创建时间。 */
  timestamp: string
}

/** Conversation 交互状态。 */
export type ConversationStatus = 'idle' | 'sending' | 'thinking' | 'speaking' | 'error'
