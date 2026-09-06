import * as THREE from 'three'
import { VRM, VRMUtils } from '@pixiv/three-vrm'
import { getModelDefinition, type AvatarModelDefinition } from '../../Model'
import { AvatarLoader } from '../AvatarLoader'

/** 模型管理器的基础生命周期状态。 */
export type ModelManagerState = 'idle' | 'loading' | 'ready' | 'disposing' | 'error'

/** 模型加载完成后的回调参数。 */
export interface LoadedAvatarModel {
  /** Registry 中的模型描述；直接 URL 加载时为临时描述。 */
  definition: AvatarModelDefinition
  /** 已完成 VRM 解析的运行时对象。 */
  vrm: VRM
}

/** ModelManager 生命周期变化通知。 */
export interface ModelManagerStateChange {
  /** 当前生命周期状态。 */
  state: ModelManagerState
  /** 当前模型 ID；加载中可能为空。 */
  currentModelId: string | null
  /** 最近一次错误。 */
  error: Error | null
}

/** 模型卸载前由 AvatarViewer 清理 Mixer、Feature 和更新回调。 */
export interface ModelManagerOptions {
  /** 在场景释放前解除与当前 VRM 相关的运行时绑定。 */
  onBeforeUnload?: (model: LoadedAvatarModel) => void
  /** 模型生命周期变化回调。 */
  onStateChanged?: (change: ModelManagerStateChange) => void
}

/**
 * 负责模型 Registry 查询、VRM 异步加载、场景挂载及资源释放。
 * 该类不处理模型入场/离场动画，过渡编排由后续 Controller 负责。
 */
export class ModelManager {
  /** 模型挂载场景。 */
  private readonly scene: THREE.Scene
  /** VRM 底层加载器。 */
  private readonly loader: AvatarLoader
  /** 卸载前清理 Avatar Runtime 的回调。 */
  private readonly onBeforeUnload: ((model: LoadedAvatarModel) => void) | undefined
  /** 生命周期状态通知回调。 */
  private readonly onStateChanged: ((change: ModelManagerStateChange) => void) | undefined
  /** 当前已挂载模型。 */
  private current: LoadedAvatarModel | null = null
  /** 当前模型生命周期状态。 */
  private state: ModelManagerState = 'idle'
  /** 最近一次加载错误。 */
  private error: Error | null = null
  /** 管理器是否已释放。 */
  private disposed = false
  /** 只允许最后一次 load 的异步结果安装到场景。 */
  private loadRequestId = 0

  /** 创建模型管理器并指定模型挂载场景。 */
  public constructor(
    scene: THREE.Scene,
    loader: AvatarLoader,
    options: ModelManagerOptions = {},
  ) {
    this.scene = scene
    this.loader = loader
    this.onBeforeUnload = options.onBeforeUnload
    this.onStateChanged = options.onStateChanged
  }

  /** 当前状态。 */
  public getState(): ModelManagerState {
    return this.state
  }

  /** 当前模型 ID；尚未加载或已卸载时返回 null。 */
  public getCurrentModelId(): string | null {
    return this.current?.definition.id ?? null
  }

  /** 当前已加载模型；调用方不应直接 dispose 其 VRM。 */
  public getCurrent(): LoadedAvatarModel | null {
    return this.current
  }

  /**
   * 按 Registry ID 加载模型；传入 URL 仍兼容旧的 AvatarViewer.load(url) 调用。
   * 加载新模型前会先完整卸载当前模型，避免场景和 VRM 资源残留。
   */
  public async load(idOrUrl: string): Promise<LoadedAvatarModel> {
    if (this.disposed) throw new Error('ModelManager has been disposed')
    const requestId = ++this.loadRequestId
    const definition = getModelDefinition(idOrUrl) ?? this.createUrlDefinition(idOrUrl)
    await this.unloadCurrentInternal()
    if (this.disposed || requestId !== this.loadRequestId) {
      throw new DOMException('Avatar model load was superseded', 'AbortError')
    }
    this.setState('loading', null)

    try {
      const vrm = await this.loader.loadAvatar(definition.url)
      if (this.disposed || requestId !== this.loadRequestId) {
        VRMUtils.deepDispose(vrm.scene)
        throw new DOMException('Avatar model load was superseded', 'AbortError')
      }
      VRMUtils.rotateVRM0(vrm)
      this.scene.add(vrm.scene)
      this.current = { definition, vrm }
      this.setState('ready', null)
      return this.current
    } catch (reason) {
      const error = reason instanceof Error ? reason : new Error(String(reason))
      // 被新请求或 dispose 淘汰的加载不代表当前管理器失败；不能让旧
      // Promise 的 error 状态覆盖新一轮 loading/ready 状态。
      if (!this.disposed && requestId === this.loadRequestId) this.setState('error', error)
      throw error
    }
  }

  /** 卸载当前模型并释放 VRM 场景、几何体、材质和纹理。 */
  public async unloadCurrent(): Promise<void> {
    // 外部卸载（包括模型切换和 dispose）会使所有在途加载结果失效。
    this.loadRequestId += 1
    await this.unloadCurrentInternal()
  }

  /** 执行实际卸载；load() 内部调用时不递增请求号。 */
  private async unloadCurrentInternal(): Promise<void> {
    const current = this.current
    if (!current) return
    this.setState('disposing', null)
    this.onBeforeUnload?.(current)
    this.scene.remove(current.vrm.scene)
    VRMUtils.deepDispose(current.vrm.scene)
    this.current = null
    this.setState('idle', null)
  }

  /** 释放管理器；调用后不能再次加载模型。 */
  public dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.loadRequestId += 1
    void this.unloadCurrent().catch((reason: unknown) => {
      console.error('Failed to dispose current avatar model', reason)
    })
    this.onStateChanged?.({ state: 'idle', currentModelId: null, error: null })
  }

  /** 更新生命周期状态并通知订阅者。 */
  private setState(state: ModelManagerState, error: Error | null): void {
    this.state = state
    this.error = error
    this.onStateChanged?.({
      state,
      currentModelId: this.current?.definition.id ?? null,
      error,
    })
  }

  /** 为兼容旧 URL API 创建临时模型描述。 */
  private createUrlDefinition(url: string): AvatarModelDefinition {
    return {
      id: url,
      name: url.split('/').pop() ?? url,
      url,
      source: url,
    }
  }
}
