import type {
  ConversationAudioResponse,
  ConversationLipSyncResponse,
  ConversationSpeechChunkResponse,
} from '../api/conversationApi'
import { LipSyncPlayer } from '../lipsync/LipSyncPlayer'
import type { AvatarViewer } from '../avatar/AvatarViewer'
import {
  InteractionVoiceManager,
  type InteractionVoiceCallbacks,
  type InteractionVoiceIntent,
} from './InteractionVoiceManager'
import { AudioScheduler } from './AudioScheduler'
import type { AudioTask } from './audio.types'
import { useAvatarStore } from '../stores/avatar'

/**
 * 统一协调 Interaction Voice 与正式 AI Audio。
 * 正式回答开始前会停止所有系统语音，并把同一份 LipSync 时间轴绑定到 AvatarViewer。
 */
export class AvatarAudioManager {
  private readonly viewer: AvatarViewer
  /** 应用级唯一音频调度器。 */
  private readonly scheduler: AudioScheduler
  private readonly interaction: InteractionVoiceManager
  private responsePlayer: LipSyncPlayer | null = null
  /** 当前正式回答 generation；用于一次性淘汰其所有 Chunk 任务。 */
  private activeResponseGeneration: string | null = null
  private streamingFinishedGeneration: string | null = null
  /** 当前是否已为本轮 TTS 安装 talking 基础动作，避免每个 Chunk 重复切换。 */
  private talkingAnimationGeneration: string | null = null
  private disposed = false

  /** 创建音频管理器并绑定 Avatar。 */
  public constructor(
    viewer: AvatarViewer,
    callbacks: InteractionVoiceCallbacks = {},
  ) {
    this.viewer = viewer
    this.scheduler = new AudioScheduler()
    this.interaction = new InteractionVoiceManager(this.scheduler, {
      ...callbacks,
      onLipSync: (player, getCurrentTime) => {
        viewer.setLipSyncPlayer(player, getCurrentTime)
        callbacks.onLipSync?.(player, getCurrentTime)
      },
    })
  }

  /** 播放一个 Interaction Voice。 */
  public async playInteraction(intent: InteractionVoiceIntent, generationId = 'system'): Promise<void> {
    await this.interaction.play(intent, generationId)
  }

  /** 串行播放提示音并等待其结束，确保正式回答不会与提示音重叠。 */
  public async playInteractionAndWait(
    intent: InteractionVoiceIntent,
    generationId = 'system',
  ): Promise<void> {
    await this.interaction.playAndWait(intent, generationId)
  }
  /** 为当前 generation 安排 waiting-short/long/timeout 提示。 */
  public scheduleWaiting(generationId: string): void { this.interaction.scheduleWaiting(generationId) }

  /**
   * 登记一轮新的正式回答，并立即淘汰上一轮响应音频。
   *
   * 新请求可能在首个 SSE Chunk 到达前开始；若只在 Chunk 入队时切换，
   * 上一轮音频会继续占用唯一 AudioScheduler，造成旧语音污染新请求。
   */
  public beginResponseGeneration(generationId: string): void {
    if (this.disposed || this.activeResponseGeneration === generationId) return
    const hadResponse = this.activeResponseGeneration !== null
    this.interaction.stop()
    this.stopResponse()
    if (hadResponse) void this.viewer.playIdleAnimation()
    this.activeResponseGeneration = generationId
  }

  /** 停止 Interaction Voice 和正式回答音频。 */
  public stop(): void {
    this.interaction.stop()
    this.stopResponse()
    // 取消整轮 TTS 后不应把 talking 基础动作继续保留为下一状态。
    void this.viewer.playIdleAnimation()
  }

  /** 停止系统语音但不停止正式回答音频。 */
  public stopInteraction(): void {
    this.interaction.stop()
  }

  /** 播放后端返回的 AI 音频并同步 LipSync。 */
  public async playResponse(
    audio: ConversationAudioResponse,
    lipsync: ConversationLipSyncResponse | null,
    resolveUrl: (url: string) => string,
    chunks: readonly ConversationSpeechChunkResponse[] = [],
    generationId = `response-${Date.now()}`,
  ): Promise<void> {
    if (this.disposed) return
    this.interaction.stop()
    this.stopResponse()
    this.activeResponseGeneration = generationId
    this.streamingFinishedGeneration = null
    this.ensureTalkingAnimation(generationId)
    if (chunks.length > 0) {
      await this.playChunkedResponse(chunks, resolveUrl, generationId)
      return
    }
    this.responsePlayer = lipsync
      ? new LipSyncPlayer({
          version: 1,
          duration: lipsync.duration,
          events: lipsync.frames.map((frame) => ({
            ...frame,
            type:
              frame.type === 'sil'
                ? 'sil'
                : (frame.type as 'aa' | 'ih' | 'ou' | 'ee' | 'oh'),
          })),
        })
      : null
    const task: AudioTask = {
      id: `response-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type: 'response', priority: 'HIGH', status: 'queued', createdAt: Date.now(),
      audioUrl: resolveUrl(audio.url), conversationId: null, requestId: null,
      generationId, cancellable: true, interruptible: true,
      onStart: () => this.responsePlayer?.play(),
      onComplete: () => {
        this.clearResponsePlayer()
        this.talkingAnimationGeneration = null
        void this.viewer.playIdleAnimation()
      },
      onCancel: () => {
        this.stopResponse()
        void this.viewer.playIdleAnimation()
      },
      onError: () => {
        this.stopResponse()
        void this.viewer.playIdleAnimation()
      },
    }
    this.viewer.setLipSyncPlayer(
      this.responsePlayer,
      () => this.scheduler.getCurrentTime(),
    )
    await this.scheduler.enqueue(task)
  }

  /** 流式响应收到单个 Chunk 后立即入队，不等待后续 TTS。 */
  public async enqueueStreamingChunk(
    chunk: ConversationSpeechChunkResponse,
    resolveUrl: (url: string) => string,
    generationId: string,
  ): Promise<void> {
    if (this.disposed) return
    this.beginResponseGeneration(generationId)
    this.ensureTalkingAnimation(generationId)
    const player = new LipSyncPlayer({ version: 1, duration: chunk.lipsync.duration, events: chunk.lipsync.frames.map((frame) => ({ ...frame, type: frame.type === 'sil' ? 'sil' : (frame.type as 'aa' | 'ih' | 'ou' | 'ee' | 'oh') })) })
    const task: AudioTask = {
      id: `response-stream-${generationId}-${chunk.id}`, type: 'response', priority: 'HIGH', status: 'queued', createdAt: Date.now() + chunk.index,
      audioUrl: resolveUrl(chunk.audio.url), conversationId: null, requestId: null, generationId, cancellable: true, interruptible: true,
      onStart: (audio) => { if (this.activeResponseGeneration !== generationId) return; this.responsePlayer = player; player.play(); this.viewer.setLipSyncPlayer(player, () => audio.currentTime) },
      onComplete: () => { player.reset(); this.maybeFinishStreaming(generationId) }, onCancel: () => { player.reset(); this.maybeFinishStreaming(generationId) }, onError: () => { player.reset(); this.maybeFinishStreaming(generationId) },
    }
    useAvatarStore.getState().setAvatarState('speaking')
    useAvatarStore.getState().setAudioState('playing')
    await this.scheduler.enqueue(task)
  }

  /** 标记流式响应完成；队列耗尽后由最后一个任务清理嘴型。 */
  public finishStreamingResponse(generationId: string): void {
    this.streamingFinishedGeneration = generationId
    this.maybeFinishStreaming(generationId)
  }

  /** 队列真正耗尽后才恢复 Avatar idle，避免 SSE complete 早于音频结束。 */
  private maybeFinishStreaming(generationId: string): void {
    if (this.streamingFinishedGeneration === generationId && this.activeResponseGeneration === generationId && !this.scheduler.getCurrentTask() && this.scheduler.getPendingTasks().length === 0) {
      this.clearResponsePlayer(); this.talkingAnimationGeneration = null; void this.viewer.playIdleAnimation(); useAvatarStore.getState().setAudioState('idle'); useAvatarStore.getState().setAvatarState('idle'); useAvatarStore.getState().setLipSyncState('idle'); this.streamingFinishedGeneration = null
    }
  }

  /** 将后端独立生成的 Chunk 逐个加入同一 AudioScheduler，实现连续 Avatar 播放。 */
  private async playChunkedResponse(
    chunks: readonly ConversationSpeechChunkResponse[],
    resolveUrl: (url: string) => string,
    generationId: string,
  ): Promise<void> {
    this.ensureTalkingAnimation(generationId)
    const ordered = [...chunks].sort((left, right) => left.index - right.index)
    const completions = ordered.map((chunk, index) => {
      const player = new LipSyncPlayer({
        version: 1,
        duration: chunk.lipsync.duration,
        events: chunk.lipsync.frames.map((frame) => ({
          ...frame,
          type: frame.type === 'sil' ? 'sil' : (frame.type as 'aa' | 'ih' | 'ou' | 'ee' | 'oh'),
        })),
      })
      const isLastChunk = index === ordered.length - 1
      const task: AudioTask = {
        id: `response-chunk-${chunk.id}`, type: 'response', priority: 'HIGH', status: 'queued',
        createdAt: Date.now() + index, audioUrl: resolveUrl(chunk.audio.url), conversationId: null,
        requestId: null, generationId, cancellable: true, interruptible: true,
        onStart: (audio) => {
          if (this.activeResponseGeneration !== generationId) return
          this.responsePlayer?.reset()
          this.responsePlayer = player
          player.play()
          this.viewer.setLipSyncPlayer(player, () => audio.currentTime)
        },
        onComplete: () => {
          player.reset()
          if (isLastChunk && this.activeResponseGeneration === generationId) { this.clearResponsePlayer(); this.talkingAnimationGeneration = null; void this.viewer.playIdleAnimation() }
        },
        onCancel: () => player.reset(),
        onError: () => player.reset(),
      }
      return this.scheduler.enqueue(task)
    })
    await Promise.all(completions)
  }

  /** 释放全部音频资源和 LipSync。 */
  public dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.interaction.dispose()
    this.stopResponse()
    this.scheduler.dispose()
  }

  private stopResponse(): void {
    if (this.activeResponseGeneration) this.scheduler.cancelGeneration(this.activeResponseGeneration)
    this.activeResponseGeneration = null
    this.streamingFinishedGeneration = null
    this.talkingAnimationGeneration = null
    this.clearResponsePlayer()
  }

  /** 正式音频结束后的纯资源清理，不再次操作 Scheduler 状态。 */
  private clearResponsePlayer(): void {
    this.responsePlayer?.reset()
    this.responsePlayer = null
    this.activeResponseGeneration = null
    this.viewer.setLipSyncPlayer(null)
  }

  /**
   * 为本轮 TTS 安装一次 Talking 基础动作。
   *
   * 所有音频入口共用此方法，保证 Talking 身体层不会因流式 Chunk 或旧协议
   * 分叉而漏切换；实际资源由 AvatarViewer 按 Registry 回退到普通 Idle。
   */
  private ensureTalkingAnimation(generationId: string): void {
    if (this.talkingAnimationGeneration === generationId) return
    this.talkingAnimationGeneration = generationId
    void this.viewer.playTalkingAnimation()
  }
}
