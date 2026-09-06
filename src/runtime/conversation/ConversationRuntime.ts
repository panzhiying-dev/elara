import { ConversationApiError } from '../../api/conversationApi'
import { ConversationService } from '../../conversation/ConversationService'
import type { SendMessageResponse, ConversationSpeechChunkResponse } from '../../api/conversationApi'
import type { ConversationStreamEvent } from '../../api/conversationStream'
import { useAvatarStore } from '../../stores/avatar'
import { DEFAULT_CONVERSATION_PRESENTATION_CONFIG } from '../../config/conversation.config'

/** Conversation Runtime 发出的 assistant-ui 兼容文本结果。 */
export interface ConversationRuntimeResult {
  /** assistant 消息文本。 */
  text: string
  /** 原始后端响应，供 Avatar Runtime 消费语音数据。 */
  response: SendMessageResponse
  /** 本轮隔离标识。 */
  generationId: string
  /** 网络请求标识。 */
  requestId: string
}

/** ConversationRuntime 与 Avatar 表现层之间的生命周期回调。 */
export interface ConversationRuntimeCallbacks {
  /** 请求超过延迟仍未收到响应时，仅触发一次 Thinking。 */
  onThinkingStarted?: (generationId: string) => void
  /** 收到首个文本事件时结束 Thinking。 */
  onResponseStarted?: (generationId: string) => void
}

/** assistant-ui 与 Elara API、Avatar Store 之间的唯一业务桥梁。 */
export class ConversationRuntime {
  private readonly service: ConversationService
  private generation = 0
  private activeGeneration: string | null = null
  private thinkingTimer: ReturnType<typeof setTimeout> | null = null
  private errorTimer: ReturnType<typeof setTimeout> | null = null
  /** 当前请求是否已经触发过 Thinking，避免循环播放。 */
  private thinkingTriggered = false
  /** 当前请求是否已收到首个响应事件。 */
  private responseStarted = false
  private readonly callbacks: ConversationRuntimeCallbacks

  /** 清除本轮 Thinking 延迟，避免首个响应到达后仍闪现 Thinking。 */
  private clearThinkingTimer(): void {
    if (this.thinkingTimer === null) return
    clearTimeout(this.thinkingTimer)
    this.thinkingTimer = null
  }

  /** 创建 Runtime；Conversation ID 只保存在该服务中。 */
  public constructor(service = new ConversationService(), callbacks: ConversationRuntimeCallbacks = {}) {
    this.service = service
    this.callbacks = callbacks
  }
  /** 执行一轮消息请求并同步 Avatar Runtime 状态。 */
  public async send(content: string, signal?: AbortSignal, requestedGenerationId?: string, onChunk?: (chunk: ConversationSpeechChunkResponse) => Promise<void>, onDelta?: (text: string) => void): Promise<ConversationRuntimeResult> {
    const sequence = ++this.generation
    const generationId = requestedGenerationId ?? `generation-${sequence}`
    const requestId = `request-${Date.now()}-${sequence}`
    this.activeGeneration = generationId
    const store = useAvatarStore.getState()
    store.setGenerationId(generationId)
    // 文字请求在短延迟内保持自然 Idle；只有超过配置阈值仍未返回，
    // 才显示/进入 Thinking，避免每次请求都闪现机械等待反馈。
    store.setAvatarState('idle')
    this.clearThinkingTimer()
    this.thinkingTriggered = false
    this.responseStarted = false
    this.thinkingTimer = setTimeout(() => {
      if (this.activeGeneration === generationId && !this.thinkingTriggered && !this.responseStarted) {
        this.thinkingTriggered = true
        store.setAvatarState('thinking')
        this.callbacks.onThinkingStarted?.(generationId)
      }
      this.thinkingTimer = null
    }, DEFAULT_CONVERSATION_PRESENTATION_CONFIG.thinkingTriggerDelayMs)
    try {
      if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError')
      const stream = await this.service.streamMessage(content, signal as AbortSignal, { 'X-Elara-Request-ID': requestId, 'X-Elara-Generation-ID': generationId })
      let conversationId = this.service.getConversationId() ?? ''
      let rawText = ''
      const chunks: ConversationSpeechChunkResponse[] = []
      const deliveredChunkIndexes = new Set<number>()
      const upsertChunk = (chunk: ConversationSpeechChunkResponse): ConversationSpeechChunkResponse => {
        const existing = chunks.find((item) => item.index === chunk.index)
        if (existing) {
          Object.assign(existing, chunk)
          return existing
        }
        chunks.push(chunk)
        return chunk
      }
      const deliverChunk = async (chunk: ConversationSpeechChunkResponse): Promise<void> => {
        if (deliveredChunkIndexes.has(chunk.index)) return
        deliveredChunkIndexes.add(chunk.index)
        if (onChunk) await onChunk(chunk)
      }
      for await (const item of stream) {
        if (this.activeGeneration !== generationId) throw new DOMException('Stale generation', 'AbortError')
        const event = item as ConversationStreamEvent
        if (event.type === 'message.start') { conversationId = event.data.conversation_id; this.service.setConversationId(conversationId); store.setConversationId(conversationId) }
        else if (event.type === 'message.delta') {
          this.clearThinkingTimer()
          this.markResponseStarted(generationId)
          // 兼容旧后端；新后端使用 message.chunk 携带文本。
          rawText += event.data.text
          // Runtime 只向上层报告本次新增文本，由 UI adapter 统一维护累计内容。
          onDelta?.(event.data.text)
        } else if (event.type === 'message.chunk') {
          this.clearThinkingTimer()
          this.markResponseStarted(generationId)
          rawText += event.data.text
          // Runtime 只向上层报告本次新增文本，由 UI adapter 统一维护累计内容。
          onDelta?.(event.data.text)
          if (event.data.audio && event.data.lipsync) {
            const chunk = upsertChunk({
              id: event.data.id ?? `stream-${event.data.index}`,
              index: event.data.index,
              text: event.data.text,
              audio: event.data.audio,
              lipsync: event.data.lipsync,
            })
            await deliverChunk(chunk)
          }
        }
        else if (event.type === 'audio.ready') {
          // 兼容旧后端；新后端的 message.chunk 已包含完整音频数据。
          const existing = chunks.find((chunk) => chunk.index === event.data.index)
          if (existing) {
            existing.audio = event.data.audio
            existing.text = event.data.text
          } else {
            upsertChunk({ id: `stream-${event.data.index}`, index: event.data.index, text: event.data.text, audio: event.data.audio, lipsync: { duration: event.data.audio.duration, frames: [] } })
          }
        } else if (event.type === 'lipsync.ready') {
          // 兼容旧后端：只有收到 LipSync 后，旧协议的 Chunk 才算完整。
          const chunk = chunks.find((item) => item.index === event.data.index)
          if (chunk) {
            chunk.lipsync = event.data.lipsync
            await deliverChunk(chunk)
          }
        } else if (event.type === 'message.complete') {
          this.clearThinkingTimer()
          this.markResponseStarted(generationId)
          // 仅在没有收到任何分片时使用最终快照，避免把已同步的文本重新整段替换。
          if (!rawText) {
            rawText = event.data.raw_text
            onDelta?.(rawText)
          }
        } else if (event.type === 'message.error') {
          // 文字和语音解耦：TTS/LipSync 失败时保留已收到的文字与前置音频。
          if (event.data.code !== 'TTS_ERROR' && event.data.code !== 'LIPSYNC_ERROR') throw new Error(event.data.message)
        }
      }
      this.clearThinkingTimer()
      const response = { conversation_id: conversationId, user_message: { id: '', role: 'user' as const, content, created_at: new Date().toISOString(), audio_url: null, lipsync: null }, assistant_message: { id: '', role: 'assistant' as const, content: rawText, created_at: new Date().toISOString(), audio_url: chunks[0]?.audio.url ?? null, lipsync: null }, message_id: '', raw_text: rawText, audio: chunks[0]?.audio ?? null, lipsync: null, chunks, request_id: requestId, generation_id: generationId }
      return { text: rawText, response, generationId, requestId }
    } catch (reason) {
      if (this.activeGeneration === generationId) {
        this.clearThinkingTimer()
        store.setAvatarState('error')
        if (this.errorTimer) clearTimeout(this.errorTimer)
        this.errorTimer = setTimeout(() => {
          if (this.activeGeneration === generationId) store.setAvatarState('idle')
          this.errorTimer = null
        }, 1800)
      }
      throw reason
    }
  }
  /** 取消当前 generation，旧结果将被视为过期。 */
  public cancel(): void {
    this.activeGeneration = null
    this.clearThinkingTimer()
    if (this.errorTimer) { clearTimeout(this.errorTimer); this.errorTimer = null }
    const store = useAvatarStore.getState(); store.setGenerationId(null); store.resetAvatarState()
  }

  /** 首个响应事件到达时结束 Thinking，且同一 generation 只通知一次。 */
  private markResponseStarted(generationId: string): void {
    if (this.responseStarted) return
    this.responseStarted = true
    this.callbacks.onResponseStarted?.(generationId)
  }
  /** 当前 Conversation ID。 */
  public getConversationId(): string | null { return this.service.getConversationId() }
  /** 将后端返回的音频路径转换为可由浏览器请求的 URL。 */
  public resolveAssetUrl(url: string): string { return this.service.resolveAssetUrl(url) }
  /** 将 API 错误转换为产品可识别分类。 */
  public static getErrorKind(error: unknown): string { if (error instanceof ConversationApiError) return error.kind; return error instanceof DOMException && error.name === 'AbortError' ? 'cancelled' : 'unknown' }
}
