/** 模型切换过程的状态。 */
export type ModelTransitionState = 'ready' | 'exiting' | 'loading' | 'entering' | 'error'

/** 模型切换状态通知。 */
export interface ModelTransitionChange {
  /** 当前切换状态。 */
  state: ModelTransitionState
  /** 切换前的模型 ID。 */
  currentModelId: string | null
  /** 目标模型 ID。 */
  targetModelId: string | null
  /** 最近一次错误。 */
  error: Error | null
}

/** Controller 与 AvatarViewer 之间的生命周期协作回调。 */
export interface ModelTransitionCallbacks {
  /** 当前模型 ID。 */
  getCurrentModelId: () => string | null
  /** 播放离场动作并在模型到达视口外后完成。 */
  exitCurrent: () => Promise<void>
  /** 从场景卸载当前模型。 */
  unloadCurrent: () => Promise<void>
  /** 加载目标模型但暂不开始入场。 */
  loadModel: (modelId: string) => Promise<void>
  /** 驱动新模型从屏幕外进入并回到 Idle。 */
  enterCurrent: () => Promise<void>
}

/**
 * 编排 A → Exit → Move Out → Unload → Load B → Move In → Idle 的单并发状态机。
 * 切换期间重复请求直接复用当前 Promise，避免多个模型同时加载和动画竞争。
 */
export class ModelTransitionController {
  /** 模型过渡所需的运行时协作回调。 */
  private readonly callbacks: ModelTransitionCallbacks
  /** 状态变化通知回调。 */
  private readonly onStateChanged: ((change: ModelTransitionChange) => void) | undefined
  /** 当前状态机状态。 */
  private state: ModelTransitionState = 'ready'
  /** 当前目标模型 ID。 */
  private targetModelId: string | null = null
  /** 当前唯一进行中的过渡 Promise。 */
  private activeTransition: Promise<void> | null = null
  /** Controller 是否已释放。 */
  private disposed = false

  /** 创建模型过渡控制器。 */
  public constructor(
    callbacks: ModelTransitionCallbacks,
    onStateChanged?: (change: ModelTransitionChange) => void,
  ) {
    this.callbacks = callbacks
    this.onStateChanged = onStateChanged
  }

  /** 当前过渡状态。 */
  public getState(): ModelTransitionState {
    return this.state
  }

  /** 当前是否正在进行模型切换。 */
  public isSwitching(): boolean {
    return this.activeTransition !== null
  }

  /**
   * 切换到 Registry 中的目标模型。
   * 过渡期间的新请求不会打断当前流程，调用方可据此禁用重复操作。
   */
  public switchTo(modelId: string): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('ModelTransitionController has been disposed'))
    if (this.callbacks.getCurrentModelId() === modelId && !this.activeTransition) return Promise.resolve()
    if (this.activeTransition) return this.activeTransition

    const previousModelId = this.callbacks.getCurrentModelId()
    this.targetModelId = modelId
    this.activeTransition = this.runTransition(modelId, previousModelId).finally(() => {
      this.activeTransition = null
      this.targetModelId = null
    })
    return this.activeTransition
  }

  /** 释放 Controller 并阻止后续切换请求。 */
  public dispose(): void {
    this.disposed = true
    this.activeTransition = null
    this.targetModelId = null
  }

  /** 按固定顺序执行离场、卸载、加载和入场，并处理恢复。 */
  private async runTransition(modelId: string, previousModelId: string | null): Promise<void> {
    try {
      this.setState('exiting', previousModelId, modelId, null)
      if (previousModelId) {
        await this.callbacks.exitCurrent()
        if (this.disposed) return
        await this.callbacks.unloadCurrent()
      }

      if (this.disposed) return
      this.setState('loading', null, modelId, null)
      await this.callbacks.loadModel(modelId)
      if (this.disposed) return
      this.setState('entering', modelId, modelId, null)
      await this.callbacks.enterCurrent()
      if (this.disposed) return
      this.setState('ready', modelId, null, null)
    } catch (reason) {
      if (this.disposed) return
      const error = reason instanceof Error ? reason : new Error(String(reason))
      this.setState('error', this.callbacks.getCurrentModelId(), modelId, error)
      if (previousModelId && this.callbacks.getCurrentModelId() === null) {
        try {
          await this.callbacks.loadModel(previousModelId)
          await this.callbacks.enterCurrent()
        } catch (recoveryError) {
          console.error('Failed to recover previous avatar model', recoveryError)
        }
      }
      throw error
    }
  }

  /** 发布状态机状态变化。 */
  private setState(
    state: ModelTransitionState,
    currentModelId: string | null,
    targetModelId: string | null,
    error: Error | null,
  ): void {
    if (this.disposed) return
    this.state = state
    this.onStateChanged?.({ state, currentModelId, targetModelId, error })
  }
}
