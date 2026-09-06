import type { AvatarModelDefinition } from './types'

/** Vite 在构建期收集 Model 目录中的全部 GLB 资源。 */
const MODEL_ASSETS = import.meta.glob('./*.glb', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

/** 将资源文件名转换为稳定的模型 ID。 */
function getModelId(path: string): string {
  const fileName = path.split('/').pop() ?? path
  return fileName.replace(/\.glb$/i, '').toLowerCase()
}

/** 将文件名转换为适合 UI 展示的默认名称。 */
function getModelName(path: string): string {
  const fileName = path.split('/').pop() ?? path
  const baseName = fileName.replace(/\.glb$/i, '')
  const spaced = baseName.replace(/[-_]+/g, ' ').trim()
  return spaced.replace(/\b\w/g, (character) => character.toUpperCase())
}

/**
 * 模型资源唯一注册表。
 *
 * 新增模型只需将 `.glb` 文件放入当前目录；Vite 会在构建时自动发现，
 * UI 和运行时均通过本注册表读取模型列表，不再维护额外的路径映射。
 */
export const MODEL_REGISTRY: readonly AvatarModelDefinition[] = Object.entries(
  MODEL_ASSETS,
)
  .map(([path, url]) => ({
    id: getModelId(path),
    name: getModelName(path),
    url,
    source: path,
  }))
  .sort((left, right) => left.id.localeCompare(right.id))

const MODEL_BY_ID = new Map(
  MODEL_REGISTRY.map((definition) => [definition.id, definition]),
)

/** 当前项目原有的默认模型，保持初始化行为不变。 */
export const DEFAULT_MODEL_ID = 'elara'

/** 返回全部已发现模型，供 UI 和模型管理逻辑使用。 */
export function listModels(): readonly AvatarModelDefinition[] {
  return MODEL_REGISTRY
}

/** 按模型 ID 查询资源描述；未知 ID 返回 undefined。 */
export function getModelDefinition(
  id: string,
): AvatarModelDefinition | undefined {
  return MODEL_BY_ID.get(id)
}
