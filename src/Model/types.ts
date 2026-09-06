/** 单个 Avatar 模型的资源描述。 */
export interface AvatarModelDefinition {
  /** 模型唯一标识，由资源文件名生成。 */
  id: string
  /** UI 中展示的模型名称。 */
  name: string
  /** Vite 构建后的模型资源 URL。 */
  url: string
  /** 资源来源说明，便于追踪模型的来源。 */
  source: string
}
