import { AudioPlaybackManager } from './AudioPlaybackManager'
import type { AudioTask, AudioTaskPriority } from './audio.types'

/**
 * 单实例、可抢占的音频调度器。
 * 通过优先级和 generation 丢弃过期任务，解决等待提示音与正式回答的竞态。
 */
export class AudioScheduler {
  /** 唯一底层播放器。 */
  private readonly playback: AudioPlaybackManager
  /** 等待播放的任务。 */
  private readonly pending: AudioTask[] = []
  /** 当前正在播放的任务。 */
  private current: AudioTask | null = null
  /** 已失效的 generation 集合。 */
  private readonly invalidGenerations = new Set<string>()
  /** 每个任务的完成 Promise，供业务层感知失败或取消。 */
  private readonly waiters = new Map<string, { resolve: () => void; reject: (error: Error) => void }>()
  /** 调度器是否已释放。 */
  private disposed = false

  /** 创建调度器；可注入播放器便于测试。 */
  public constructor(playback = new AudioPlaybackManager()) { this.playback = playback }

  /** 将任务加入优先级队列；高优先级任务立即抢占低优先级播放。 */
  public enqueue(task: AudioTask): Promise<void> {
    if (this.disposed || this.invalidGenerations.has(task.generationId)) {
      task.status = 'stale'; task.onCancel?.(); return Promise.resolve()
    }
    task.status = 'queued'
    if (task.priority === 'HIGH') {
      this.invalidateLowerPriorityTasks()
      // 只有高优先级任务才能抢占低/中优先级；同优先级的 Response Chunk
      // 必须等待前一段自然结束，避免后入队的 Chunk 打断当前 Chunk。
      if (this.current && this.priorityValue(this.current.priority) < this.priorityValue(task.priority)) {
        this.interruptCurrent()
      }
    }
    this.pending.push(task)
    this.sortPending()
    const completion = new Promise<void>((resolve, reject) => { this.waiters.set(task.id, { resolve, reject }) })
    void this.pump()
    return completion
  }

  /** 取消指定任务。 */
  public cancel(taskId: string): void {
    const index = this.pending.findIndex((task) => task.id === taskId)
    if (index >= 0) { const [task] = this.pending.splice(index, 1); this.cancelTask(task) }
    if (this.current?.id === taskId) this.interruptCurrent()
  }

  /** 让 generation 下所有任务失效，并停止当前播放。 */
  public cancelGeneration(generationId: string): void {
    this.invalidGenerations.add(generationId)
    for (let index = this.pending.length - 1; index >= 0; index -= 1) {
      if (this.pending[index].generationId === generationId) {
        const [task] = this.pending.splice(index, 1); this.cancelTask(task)
      }
    }
    if (this.current?.generationId === generationId) this.interruptCurrent()
  }

  /** 将 generation 标记为过期，但不影响其他 generation。 */
  public invalidateGeneration(generationId: string): void { this.cancelGeneration(generationId) }

  /** 清除所有交互提示音任务。 */
  public clearPendingInteractionVoices(): void {
    for (let index = this.pending.length - 1; index >= 0; index -= 1) {
      if (this.pending[index].type === 'interaction') {
        const [task] = this.pending.splice(index, 1); this.cancelTask(task)
      }
    }
    if (this.current?.type === 'interaction') this.interruptCurrent()
  }

  /** 停止当前可打断任务。 */
  public interruptCurrent(): void {
    if (!this.current) return
    const task = this.current
    if (task.interruptible) {
      task.status = 'cancelled'
      // 先解除 current 引用，再调用回调；回调可能触发 cancelGeneration，
      // 必须避免重新进入 interruptCurrent 造成递归。
      this.current = null
      this.playback.stop()
      task.onCancel?.()
      this.resolveTask(task)
    }
  }

  /** 取消全部任务并停止底层音频。 */
  public cancelAll(): void {
    while (this.pending.length) this.cancelTask(this.pending.pop() as AudioTask)
    this.interruptCurrent()
  }

  /** 当前任务只读快照。 */
  public getCurrentTask(): AudioTask | null { return this.current }
  /** 当前底层音频播放时间。 */
  public getCurrentTime(): number { return this.playback.getCurrentTime() }
  /** 待播放任务只读快照。 */
  public getPendingTasks(): readonly AudioTask[] { return [...this.pending] }

  /** 释放调度器。 */
  public dispose(): void { this.disposed = true; this.cancelAll(); this.playback.dispose() }

  /** 执行队列头部任务；旧 Promise 完成后会通过引用检查避免污染新任务。 */
  private async pump(): Promise<void> {
    if (this.current || this.disposed) return
    const task = this.pending.shift()
    if (!task) return
    if (this.invalidGenerations.has(task.generationId)) { task.status = 'stale'; task.onCancel?.(); this.resolveTask(task); return this.pump() }
    this.current = task
    task.status = 'playing'
    try {
      task.onStart?.(this.getAudioElement())
      await this.playback.play(task)
      if (this.current !== task) return
      task.status = 'completed'; task.onComplete?.(); this.resolveTask(task)
    } catch (reason) {
      if (this.current !== task) return
      task.status = 'failed'
      const error = reason instanceof Error ? reason : new Error(String(reason))
      task.onError?.(error); this.rejectTask(task, error)
    } finally {
      if (this.current === task) this.current = null
      void this.pump()
    }
  }

  /** 获取底层元素，仅供任务回调绑定时间轴。 */
  private getAudioElement(): HTMLAudioElement {
    return this.playback.getElement()
  }

  /** 按优先级和创建时间排序。 */
  private sortPending(): void { this.pending.sort((a, b) => this.priorityValue(b.priority) - this.priorityValue(a.priority) || a.createdAt - b.createdAt) }
  private priorityValue(priority: AudioTaskPriority): number { return priority === 'HIGH' ? 3 : priority === 'MEDIUM' ? 2 : 1 }
  private invalidateLowerPriorityTasks(): void {
    for (let index = this.pending.length - 1; index >= 0; index -= 1) {
      if (this.pending[index].priority === 'LOW') {
        const [task] = this.pending.splice(index, 1)
        task.status = 'stale'
        task.onCancel?.()
        // 被高优先级任务淘汰的任务不会再进入 pump；必须完成其 waiter，
        // 否则调用方等待的 Promise 会永久悬挂并保留闭包引用。
        this.resolveTask(task)
      }
    }
  }
  private cancelTask(task: AudioTask): void { task.status = 'cancelled'; task.onCancel?.(); this.resolveTask(task) }
  private resolveTask(task: AudioTask): void { const waiter = this.waiters.get(task.id); if (waiter) { waiter.resolve(); this.waiters.delete(task.id) } }
  private rejectTask(task: AudioTask, error: Error): void { const waiter = this.waiters.get(task.id); if (waiter) { waiter.reject(error); this.waiters.delete(task.id) } }
}
