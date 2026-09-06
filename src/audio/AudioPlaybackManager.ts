import type { AudioTask } from './audio.types'

/**
 * 唯一的 HTMLAudioElement 持有者。
 * Scheduler 之外的模块不能直接创建或播放 Audio，以保证同一时刻只有一个声音。
 */
export class AudioPlaybackManager {
  /** 应用内唯一的音频元素。 */
  private readonly audio: HTMLAudioElement
  /** 当前播放 Promise 的清理函数。 */
  private cleanupCurrent: (() => void) | null = null
  /** 停止播放时结束当前 Promise，避免调度器留下悬挂任务。 */
  private resolveCurrent: (() => void) | null = null

  /** 创建音频播放底层。 */
  public constructor(audio?: HTMLAudioElement) {
    this.audio = audio ?? new Audio()
    this.audio.preload = 'auto'
  }

  /** 播放任务并在结束、失败或取消后完成。 */
  public play(task: AudioTask): Promise<void> {
    this.stop()
    this.audio.src = task.audioUrl
    return new Promise<void>((resolve, reject) => {
      const ended = (): void => { cleanup(); resolve() }
      const failed = (): void => { cleanup(); reject(new Error(`Audio failed: ${task.audioUrl}`)) }
      const cleanup = (): void => {
        this.audio.removeEventListener('ended', ended)
        this.audio.removeEventListener('error', failed)
        if (this.cleanupCurrent === cleanup) this.cleanupCurrent = null
        if (this.resolveCurrent === resolve) this.resolveCurrent = null
      }
      this.cleanupCurrent = cleanup
      this.resolveCurrent = resolve
      this.audio.addEventListener('ended', ended)
      this.audio.addEventListener('error', failed)
      void this.audio.play().catch((reason: unknown) => {
        cleanup()
        reject(reason instanceof Error ? reason : new Error(String(reason)))
      })
    })
  }

  /** 停止当前音频并解除事件监听。 */
  public stop(): void {
    const resolve = this.resolveCurrent
    this.cleanupCurrent?.()
    this.cleanupCurrent = null
    resolve?.()
    this.resolveCurrent = null
    this.audio.pause()
    this.audio.currentTime = 0
  }

  /** 当前音频是否正在播放。 */
  public isPlaying(): boolean { return !this.audio.paused }

  /** 当前音频时间，用于 LipSync 时间轴。 */
  public getCurrentTime(): number { return this.audio.currentTime }

  /** 返回唯一音频元素，供调度任务回调读取播放时间。 */
  public getElement(): HTMLAudioElement { return this.audio }

  /** 释放底层 Audio。 */
  public dispose(): void {
    this.stop()
    this.audio.removeAttribute('src')
    this.audio.load()
  }
}
