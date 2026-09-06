/** VRMA 动作所属的语义分类。 */
export type AvatarAnimationCategory =
  /** 基础待机状态，例如 Idle。 */
  | 'base'

  /** 移动动作，例如 Walk。 */
  | 'movement'

  /** 转身动作，例如 TurnLeft / TurnRight。 */
  | 'turning'

  /** 舞蹈动作，例如 Samba / Hip Hop。 */
  | 'dance'

  /** 对用户产生直接回应的动作，例如打招呼、挥手、点头、鼓掌。 */
  | 'response'

  /** 情绪相关动作，例如 SadIdle / Thinking。 */
  | 'emotion'

  /** 一次性行为动作，例如射击、旋转、下蹲。 */
  | 'action'

  /** 姿势动作，例如全身展示、模特姿势。 */
  | 'pose'

  /**
   * 尚未完成语义登记的动作。
   *
   * 仅作为 Vite 自动发现新 VRMA 文件时的兜底分类，
   * 正式进入动作系统前应补充对应的 KNOWN_METADATA。
   */
  | 'unknown'

/** 动作内容审核状态；pending-review 表示尚未完成可靠的运行时语义确认。 */
export type AvatarAnimationReviewStatus = 'verified' | 'pending-review'

/** 单个 VRMA 资源的注册描述。 */
export interface AvatarAnimationDefinition {
  /** 业务层使用的稳定动作 ID。 */
  id: string

  /** UI 展示名称。 */
  name: string

  /** Vite 构建后的 VRMA URL。 */
  url: string

  /** 动作分类。 */
  category: AvatarAnimationCategory

  /** 是否适合默认循环播放。 */
  loop: boolean

  /** 资源文件名或来源路径。 */
  source: string

  /** 动作语义是否已经可靠确认。 */
  reviewStatus: AvatarAnimationReviewStatus
}

/**
 * AvatarViewer 与 UI 使用的动作 ID。
 *
 * 使用 string 而不是固定联合类型，
 * 允许未来新增 VRMA 后无需修改 TypeScript 类型定义。
 *
 * Registry 负责保证实际使用的动作 ID 来自已注册资源。
 */
export type AvatarAnimationName = string
