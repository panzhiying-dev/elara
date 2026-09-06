import { ConversationApi, type SendMessageResponse } from '../api/conversationApi'
import { streamConversation } from '../api/conversationStream'

/**
 * Conversation 业务服务。
 * 它只负责把当前会话 ID 合并到请求中，HTTP 细节仍由 ConversationApi 负责。
 */
export class ConversationService {
  private readonly api: ConversationApi
  private conversationId: string | null = null
  /** 浏览器会话作用域；在首次拿到 conversation_id 前也能淘汰并发请求。 */
  private readonly sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2)}`

  /** 创建会话服务。 */
  public constructor(api = new ConversationApi()) {
    this.api = api
  }

  /** 当前会话 ID。 */
  public getConversationId(): string | null {
    return this.conversationId
  }

  /** 发送消息；首次请求不携带 conversation_id，成功后保存服务端 ID。 */
  public async sendMessage(
    content: string,
    signal?: AbortSignal,
    generationHeaders?: Record<string, string>,
  ): Promise<SendMessageResponse> {
    const request = this.conversationId
      ? { conversation_id: this.conversationId, content, content_type: 'text' as const }
      : { content, content_type: 'text' as const }
    const response = await this.api.sendMessage(request, signal, generationHeaders)
    this.conversationId = response.conversation_id
    return response
  }

  /** 建立 SSE 流；每个事件由 ConversationRuntime 解释并分流。 */
  public async streamMessage(content: string, signal: AbortSignal, headers: Record<string, string> = {}) {
    const request = this.conversationId ? { conversation_id: this.conversationId, content } : { content }
    return streamConversation(request, signal, { 'X-Elara-Session-ID': this.sessionId, ...headers })
  }

  /** 保存服务端通过 message.start 返回的会话 ID。 */
  public setConversationId(id: string): void { this.conversationId = id }

  /** 获取音频资源的绝对 URL。 */
  public resolveAssetUrl(url: string): string {
    return this.api.resolveAssetUrl(url)
  }
}
