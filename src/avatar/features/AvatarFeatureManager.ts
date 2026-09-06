import type { AvatarFeature, AvatarFeatureContext } from '../AvatarFeature'

export class AvatarFeatureManager {
  private readonly features: AvatarFeature[]
  private initialized = false

  public constructor(features: AvatarFeature[] = []) {
    this.features = features
  }

  /** 初始化全部功能；初始化完成后才会进入更新阶段。 */
  public init(context: AvatarFeatureContext): void {
    if (this.initialized) return
    this.initialized = true
    this.features.forEach((feature) => feature.init(context))
  }

  /** 向已初始化的功能转发每帧更新。 */
  public update(deltaSeconds: number): void {
    if (!this.initialized) return
    this.features.forEach((feature) => feature.update(deltaSeconds))
  }

  /** 切换指定功能的启用状态。 */
  public setEnabled(feature: AvatarFeature, enabled: boolean): void {
    if (!this.features.includes(feature)) return
    feature.setEnabled(enabled)
  }

  /** 按注册顺序销毁全部功能。 */
  public dispose(): void {
    if (!this.initialized) return
    this.features.forEach((feature) => feature.dispose())
    this.initialized = false
  }
}
