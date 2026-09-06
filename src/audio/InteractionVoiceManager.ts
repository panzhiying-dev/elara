import { AudioScheduler } from './AudioScheduler'
import type { AudioTask } from './audio.types'
import { LipSyncPlayer } from '../lipsync/LipSyncPlayer'
import { isLipSyncDocument } from '../lipsync/LipSyncValidator'

/** 预制 Interaction Voice Pack 中可用的意图。 */
export type InteractionVoiceIntent = 'request-received' | 'thinking-start' | 'waiting-short' | 'waiting-long' | 'waiting-timeout' | 'response-ready' | 'network-error' | 'server-error' | 'llm-error' | 'tts-error' | 'lipsync-error' | 'unknown-error' | 'retry' | 'retrying' | 'cancelled' | 'connection-restored'

/** Interaction Voice 播放生命周期回调。 */
export interface InteractionVoiceCallbacks {
  /** 当前提示音意图；没有播放时为 null。 */
  onPlayingChanged?: (intent: InteractionVoiceIntent | null) => void
  /** 语音资源或 LipSync 资源失败。 */
  onError?: (error: Error) => void
  /** 将 LipSync 播放器绑定到 Avatar。 */
  onLipSync?: (player: LipSyncPlayer | null, getCurrentTime: (() => number) | null) => void
}

/** 将预制语音转换为低优先级 AudioTask，统一交给全局调度器播放。 */
export class InteractionVoiceManager {
  private readonly scheduler: AudioScheduler
  private readonly callbacks: InteractionVoiceCallbacks
  private player: LipSyncPlayer | null = null
  private currentTaskId: string | null = null
  private disposed = false
  /** 使异步 lipsync fetch 返回后的旧提示音失效。 */
  private playToken = 0
  /** 由音频层统一持有的等待提示计时器。 */
  private readonly timers = new Set<number>()

  /** 创建提示音管理器；不直接持有 HTMLAudioElement。 */
  public constructor(scheduler: AudioScheduler, callbacks: InteractionVoiceCallbacks = {}) { this.scheduler = scheduler; this.callbacks = callbacks }
  /** 播放提示音。 */
  public async play(intent: InteractionVoiceIntent, generationId = 'system'): Promise<void> { await this.playInternal(intent, generationId, false) }
  /** 播放提示音并等待结束。 */
  public async playAndWait(intent: InteractionVoiceIntent, generationId = 'system'): Promise<void> { await this.playInternal(intent, generationId, false) }
  /** 停止提示音并清理 LipSync。 */
  public stop(): void { this.playToken += 1; this.stopPlayback(false) }
  /** 按 generation 安排等待提示音，计时器生命周期由本管理器统一清理。 */
  public scheduleWaiting(generationId: string): void {
    this.timers.forEach((timer) => window.clearTimeout(timer)); this.timers.clear()
    const schedule = (delay: number, intent: InteractionVoiceIntent): void => {
      const timer = window.setTimeout(() => { this.timers.delete(timer); void this.playInternal(intent, generationId, true) }, delay)
      this.timers.add(timer)
    }
    schedule(3000, 'waiting-short'); schedule(8000, 'waiting-long'); schedule(15000, 'waiting-timeout')
  }
  /** 当前是否正在播放提示音。 */
  public isPlaying(): boolean { return this.scheduler.getCurrentTask()?.id === this.currentTaskId }
  /** 释放管理器。 */
  public dispose(): void { if (!this.disposed) { this.disposed = true; this.stop() } }

  /** 加载 LipSync 并创建调度任务。 */
  private async playInternal(intent: InteractionVoiceIntent, generationId: string, preserveTimers: boolean): Promise<void> {
    if (this.disposed) return
    this.stopPlayback(preserveTimers)
    const token = ++this.playToken
    const response = await fetch(`/models/audio/${intent}/lipsync.json`)
    if (this.disposed || token !== this.playToken || !response.ok) {
      if (token !== this.playToken) return
      throw new Error(`Interaction voice LipSync request failed: ${response.status}`)
    }
    const value: unknown = await response.json()
    if (this.disposed || token !== this.playToken) return
    if (!isLipSyncDocument(value)) throw new Error(`Invalid Interaction voice LipSync: ${intent}`)
    const player = new LipSyncPlayer(value)
    const task: AudioTask = {
      id: `interaction-${intent}-${Date.now()}-${Math.random().toString(36).slice(2)}`, type: 'interaction', priority: 'LOW', status: 'queued', createdAt: Date.now(), audioUrl: `/models/audio/${intent}/audio.wav`, conversationId: null, requestId: null, generationId, cancellable: true, interruptible: true,
      onStart: (audio) => { this.player = player; player.play(); this.callbacks.onLipSync?.(player, () => audio.currentTime); this.callbacks.onPlayingChanged?.(intent) },
      onComplete: () => { this.clearPlayer(); this.callbacks.onPlayingChanged?.(null); this.currentTaskId = null },
      onCancel: () => { this.clearPlayer(); this.callbacks.onPlayingChanged?.(null); this.currentTaskId = null },
      onError: (error) => { this.clearPlayer(); this.callbacks.onError?.(error) },
    }
    this.currentTaskId = task.id
    await this.scheduler.enqueue(task)
  }
  /** 清理当前提示音时间轴。 */
  private clearPlayer(): void { this.player?.reset(); this.player = null; this.callbacks.onLipSync?.(null, null) }
  /** 停止当前提示音；连续等待提示之间可保留剩余计时器。 */
  private stopPlayback(preserveTimers: boolean): void {
    if (!preserveTimers) { this.timers.forEach((timer) => window.clearTimeout(timer)); this.timers.clear() }
    this.scheduler.clearPendingInteractionVoices()
    if (this.scheduler.getCurrentTask()?.id === this.currentTaskId) this.scheduler.interruptCurrent()
    this.clearPlayer()
    this.currentTaskId = null
  }
}
