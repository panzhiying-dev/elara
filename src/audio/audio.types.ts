/** 音频任务类别；交互提示音与正式回答使用不同优先级。 */
export type AudioTaskType = 'interaction' | 'response' | 'error' | 'retry'

/** 音频任务优先级，数值越大越优先。 */
export type AudioTaskPriority = 'LOW' | 'MEDIUM' | 'HIGH'

/** 音频任务生命周期状态。 */
export type AudioTaskStatus = 'queued' | 'playing' | 'completed' | 'cancelled' | 'failed' | 'stale'

/** 由 AudioScheduler 管理的单个可播放任务。 */
export interface AudioTask {
  /** 任务唯一 ID。 */
  id: string
  /** 任务业务类别。 */
  type: AudioTaskType
  /** 调度优先级。 */
  priority: AudioTaskPriority
  /** 当前生命周期状态。 */
  status: AudioTaskStatus
  /** 创建时间戳。 */
  createdAt: number
  /** 音频来源 URL。 */
  audioUrl: string
  /** 关联会话 ID。 */
  conversationId: string | null
  /** 关联网络请求 ID。 */
  requestId: string | null
  /** 关联对话 generation。 */
  generationId: string
  /** 是否允许取消。 */
  cancellable: boolean
  /** 播放中是否允许被高优先级任务打断。 */
  interruptible: boolean
  /** 音频开始播放时执行。 */
  onStart?: (audio: HTMLAudioElement) => void
  /** 音频自然结束时执行。 */
  onComplete?: () => void
  /** 音频失败时执行。 */
  onError?: (error: Error) => void
  /** 任务被取消或过期时执行。 */
  onCancel?: () => void
}
