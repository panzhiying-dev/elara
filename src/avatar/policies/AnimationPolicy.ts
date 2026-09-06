import type { AvatarAnimationCategory, AvatarAnimationDefinition } from '../../vrma'

/** 当前调用场景；Policy 决定动作是否有资格被 Selector 返回。 */
export type AnimationUsage = 'camera' | 'dialog'

/** Camera Mode 的显式白名单；新增分类默认不会进入摄像模式。 */
export const CAMERA_ALLOWED_CATEGORIES: readonly AvatarAnimationCategory[] = [
  'base',
  'pose',
  'dance',
]

/**
 * Happy 身体动作暂时禁用：脸部表情由 Expression/Blink/LipSync 独立管理，
 * 避免 Happy VRMA 内含闭眼或面部姿态时污染表现层。文件仍保留在资源目录。
 */
const DISABLED_ANIMATION_PATTERN = /^happy(?:-\d+)?$/i

/** 未审核动作默认关闭，避免未知 VRMA 被 UI 或自动 Selector 直接播放。 */
export function isAnimationEnabled(animation: AvatarAnimationDefinition): boolean {
  return animation.category !== 'unknown'
    && !DISABLED_ANIMATION_PATTERN.test(animation.id)
    // world-* 属于 3D World 专用资源；即使后续 metadata 误标为其他分类，
    // 当前面对面 Avatar 也不得把它们暴露给任何 Selector。
    && !/^world[-_]/i.test(animation.id)
    && !/^world[-_]/i.test(animation.source)
}

/** Camera 只接受 base/pose/dance，movement 等类别即使未来新增也默认拒绝。 */
export function isCameraAnimationAllowed(animation: AvatarAnimationDefinition): boolean {
  return isAnimationEnabled(animation) && CAMERA_ALLOWED_CATEGORIES.includes(animation.category)
}

/** 对话只使用面对面基础/回应/情绪/行为层，禁止 world movement/turning 穿透。 */
export function isDialogAnimationAllowed(animation: AvatarAnimationDefinition): boolean {
  return isAnimationEnabled(animation) && ['base', 'response', 'emotion', 'action'].includes(animation.category)
}

/** 按使用场景统一判断动作资格，避免 UI 与运行时各自维护黑名单。 */
export function isAnimationAllowed(animation: AvatarAnimationDefinition, usage: AnimationUsage): boolean {
  return usage === 'camera' ? isCameraAnimationAllowed(animation) : isDialogAnimationAllowed(animation)
}
