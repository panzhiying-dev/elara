import type { ConversationAudioResponse, ConversationLipSyncResponse } from './conversationApi'

/** SSE 基础事件字段。 */
export interface StreamBaseEvent { conversation_id: string; request_id: string; generation_id: string }
/** 会话开始事件。 */
export interface MessageStartEvent extends StreamBaseEvent { status: 'started' }
/** 旧版文本增量事件；新后端不再主动发送，但保留兼容。 */
export interface MessageDeltaEvent extends StreamBaseEvent { text: string }
/** 文本、音频和 LipSync 已完成的分片事件。 */
export interface MessageChunkEvent extends StreamBaseEvent {
  id?: string
  index: number
  text: string
  start_offset: number
  end_offset: number
  audio?: ConversationAudioResponse
  lipsync?: ConversationLipSyncResponse
}
/** 音频就绪事件。 */
export interface AudioReadyEvent extends StreamBaseEvent { index: number; text: string; audio: ConversationAudioResponse }
/** 嘴型时间轴就绪事件。 */
export interface LipSyncReadyEvent extends StreamBaseEvent { index: number; lipsync: ConversationLipSyncResponse }
/** 完整消息事件。 */
export interface MessageCompleteEvent extends StreamBaseEvent { raw_text: string; status: 'completed'; chunk_count?: number }
/** 错误事件。 */
export interface MessageErrorEvent extends Partial<StreamBaseEvent> { code: string; message: string; index?: number | null }
/** 保活事件。 */
export interface HeartbeatEvent { timestamp: string }
export type ConversationStreamEvent =
  | { type: 'message.start'; data: MessageStartEvent }
  | { type: 'message.delta'; data: MessageDeltaEvent }
  | { type: 'message.chunk'; data: MessageChunkEvent }
  | { type: 'audio.ready'; data: AudioReadyEvent }
  | { type: 'lipsync.ready'; data: LipSyncReadyEvent }
  | { type: 'message.complete'; data: MessageCompleteEvent }
  | { type: 'message.error'; data: MessageErrorEvent }
  | { type: 'heartbeat'; data: HeartbeatEvent }

/** 解析 fetch ReadableStream 中跨分片、兼容 CRLF 的 SSE 事件。 */
export async function* parseSseStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<{ type: string; data: unknown }> {
  const reader = stream.getReader(); const decoder = new TextDecoder(); let buffer = ''; let event = 'message'; let dataLines: string[] = []
  const emit = (): { type: string; data: unknown } | null => { if (!dataLines.length) return null; const raw = dataLines.join('\n'); dataLines = []; const type = event; event = 'message'; try { return { type, data: JSON.parse(raw) } } catch { return null } }
  while (true) { const { value, done } = await reader.read(); buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done }); const lines = buffer.split(/\r?\n/); buffer = lines.pop() ?? ''; for (const line of lines) { if (!line) { const item = emit(); if (item) yield item } else if (line.startsWith('event:')) event = line.slice(6).trim(); else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart()) } if (done) { if (buffer) { if (buffer.startsWith('data:')) dataLines.push(buffer.slice(5).trimStart()) } const item = emit(); if (item) yield item; break } }
}

/** 通过 POST fetch 建立 Conversation SSE 流。 */
export async function streamConversation(request: { content: string; conversation_id?: string }, signal: AbortSignal, headers: Record<string, string> = {}): Promise<AsyncGenerator<{ type: string; data: unknown }>> {
  const response = await fetch('/api/v1/conversations/messages/stream', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(request), signal })
  if (!response.ok || !response.body) throw new Error(`SSE request failed (${response.status})`)
  return parseSseStream(response.body)
}
