/** Conversation API 的请求体。 */
export interface SendMessageRequest {
  /** 已有会话 ID；首次请求省略。 */
  conversation_id?: string
  /** 用户文本。 */
  content: string
  /** 当前仅支持文本。 */
  content_type: 'text'
}

/** 后端音频响应。 */
export interface ConversationAudioResponse {
  /** WAV 音频 URL，可为后端相对路径。 */
  url: string
  /** 音频格式。 */
  format: string
  /** 音频时长（秒）。 */
  duration: number
}

/** 后端 LipSync 帧。 */
export interface ConversationLipSyncResponse {
  /** 时间轴时长（秒）。 */
  duration: number
  /** Viseme 帧列表。 */
  frames: Array<{ start: number; end: number; type: string; weight: number }>
}

/** 后端返回的单段语音结果，可交由 AudioScheduler 顺序播放。 */
export interface ConversationSpeechChunkResponse {
  /** 文本切片唯一 ID。 */
  id: string
  /** 切片顺序。 */
  index: number
  /** 当前段朗读文本。 */
  text: string
  /** 当前段独立音频。 */
  audio: ConversationAudioResponse
  /** 当前段独立嘴型时间轴。 */
  lipsync: ConversationLipSyncResponse
}

/** Conversation API 返回的消息。 */
export interface ConversationMessageResponse {
  /** 消息 ID。 */
  id: string
  /** 消息角色。 */
  role: 'user' | 'assistant'
  /** 消息文本。 */
  content: string
  /** 服务端创建时间。 */
  created_at: string
  /** 助手消息关联音频。 */
  audio_url: string | null
  /** 助手消息关联唇形数据。 */
  lipsync: ConversationLipSyncResponse | null
}

/** 发送消息的真实后端响应。 */
export interface SendMessageResponse {
  /** 当前会话 ID。 */
  conversation_id: string
  /** 本次用户消息。 */
  user_message: ConversationMessageResponse
  /** 本次助手消息。 */
  assistant_message: ConversationMessageResponse
  /** 助手消息 ID。 */
  message_id: string
  /** Agent 原始文本。 */
  raw_text: string
  /** TTS 音频。 */
  audio: ConversationAudioResponse | null
  /** LipSync 时间轴。 */
  lipsync: ConversationLipSyncResponse | null
  /** 可选分段语音；旧后端未提供时为空数组。 */
  chunks?: ConversationSpeechChunkResponse[]
  /** 服务端请求 ID。 */
  request_id?: string | null
  /** 服务端 generation ID。 */
  generation_id?: string | null
}

/** 后端统一错误响应。 */
export interface ApiErrorResponse {
  /** 稳定错误码。 */
  code?: string
  /** 面向客户端的错误信息。 */
  message?: string
}

/** 可供 UI 区分的请求错误类型。 */
export type ConversationErrorKind =
  | 'network'
  | 'server'
  | 'llm'
  | 'tts'
  | 'lipsync'
  | 'unknown'

/** 包含后端错误码和分类的 Conversation 异常。 */
export class ConversationApiError extends Error {
  /** 错误分类。 */
  public readonly kind: ConversationErrorKind
  /** 后端错误码。 */
  public readonly code: string | null
  /** HTTP 状态。 */
  public readonly status: number | null

  /** 创建可分类的 API 错误。 */
  public constructor(
    message: string,
    kind: ConversationErrorKind,
    code: string | null = null,
    status: number | null = null,
  ) {
    super(message)
    this.name = 'ConversationApiError'
    this.kind = kind
    this.code = code
    this.status = status
  }
}

/**
 * 封装 Conversation HTTP 请求。
 * Base URL 通过 VITE_API_BASE_URL 配置；默认使用当前 Web Origin，
 * 由 Vite 或生产反向代理转发 /api 请求，避免生产代码绑定 localhost。
 */
export class ConversationApi {
  private readonly baseUrl: string

  /** 创建 API 客户端。 */
  public constructor(baseUrl = import.meta.env.VITE_API_BASE_URL ?? '/') {
    this.baseUrl = baseUrl.replace(/\/$/, '')
  }

  /** 发送首条或后续文本消息。 */
  public async sendMessage(
    request: SendMessageRequest,
    signal?: AbortSignal,
    generationHeaders?: Record<string, string>,
  ): Promise<SendMessageResponse> {
    return this.request<SendMessageResponse>('/api/v1/conversations/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...generationHeaders },
      body: JSON.stringify(request),
      signal,
    })
  }

  /** 将后端相对音频 URL 转换为可播放的绝对 URL。 */
  public resolveAssetUrl(url: string): string {
    if (/^https?:\/\//i.test(url)) return url

    // 服务端配置可能将静态挂载点设置为绝对路径（例如
    // /Users/.../ELARA-SRV）。保留这段 URL 路径，才能兼容该部署方式；
    // 标准 /outputs 配置也会自然落到同一逻辑。
    const normalized = url.replace(/\\/g, '/').replace(/^\/+/, '')
    const encodedPath = normalized
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/')
    // 默认 baseUrl 为 '/'；直接拼接会产生 '//outputs/...'，被浏览器解析成协议相对 URL。
    if (!this.baseUrl || this.baseUrl === '/') return `/${encodedPath}`
    return `${this.baseUrl}/${encodedPath}`
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    let response: Response
    try {
      response = await fetch(`${this.baseUrl}${path}`, init)
    } catch (reason) {
      throw new ConversationApiError(
        reason instanceof Error ? reason.message : 'Network request failed',
        'network',
      )
    }

    if (response.ok) {
      return response.json() as Promise<T>
    }

    let payload: ApiErrorResponse = {}
    try {
      payload = (await response.json()) as ApiErrorResponse
    } catch {
      // 非 JSON 错误响应使用 HTTP 状态文本。
    }
    const code = typeof payload.code === 'string' ? payload.code : null
    const message =
      typeof payload.message === 'string'
        ? payload.message
        : `Request failed (${response.status})`
    throw new ConversationApiError(
      message,
      this.classifyError(code, response.status),
      code,
      response.status,
    )
  }

  private classifyError(
    code: string | null,
    status: number,
  ): ConversationErrorKind {
    if (code === 'AGENT_ERROR') return 'llm'
    if (code === 'LIPSYNC_FAILED') return 'lipsync'
    if (status >= 500) return 'server'
    return 'unknown'
  }
}
