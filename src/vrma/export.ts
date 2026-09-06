/** VRMA 资源的集中导出入口，供业务层和 UI 复用同一注册表。 */
export {
  ANIMATION_REGISTRY,
  getAnimationDefinition,
  listAnimations,
} from './registry'
export type {
  AvatarAnimationCategory,
  AvatarAnimationDefinition,
  AvatarAnimationName,
  AvatarAnimationReviewStatus,
} from './types'
