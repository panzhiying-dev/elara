import { listAnimations, type AvatarAnimationDefinition } from '../../vrma'
import {
  isAnimationAllowed,
  type AnimationUsage,
} from './AnimationPolicy'

/**
 * 根据当前使用场景返回可供 UI/自动策略选择的动作。
 * Registry 只描述资源存在性，本 Selector 负责应用 Policy，不让 world/unknown
 * 动作通过某个面板直接进入 Avatar Runtime。
 */
export function selectAnimations(usage: AnimationUsage): readonly AvatarAnimationDefinition[] {
  return listAnimations().filter((animation) => isAnimationAllowed(animation, usage))
}

/** 从通过 Policy 的动作中查找指定 ID；找不到时返回 undefined。 */
export function selectAnimation(id: string, usage: AnimationUsage): AvatarAnimationDefinition | undefined {
  return selectAnimations(usage).find((animation) => animation.id === id)
}

