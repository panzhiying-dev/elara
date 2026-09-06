import type { AvatarAnimationName } from '../../vrma'
import { selectAnimations } from '../policies'

/** 动画面板使用的分组与展示名称；实际 URL 映射仍由 AvatarViewer 管理。 */
const CATEGORY_LABELS: Record<string, string> = {
  base: 'Base',
  movement: 'Movement',
  turning: 'Turning',
  dance: 'Dance',
  response: 'Response',
  emotion: 'Emotion',
  action: 'Actions & Poses',
  pose: 'Pose',
  unknown: 'Pending Review',
}
const CATEGORY_ORDER = ['movement', 'dance', 'turning', 'base', 'emotion', 'response', 'action', 'pose']

/** 按 Registry 分类聚合动作，保证 UI 不再维护第二份动作清单。 */
export const AVATAR_ANIMATION_GROUPS: ReadonlyArray<{
  label: string
  options: ReadonlyArray<{
    name: AvatarAnimationName
    label: string
  }>
}> = Array.from(
  selectAnimations('dialog').reduce((groups, animation) => {
    const options = groups.get(animation.category) ?? []
    options.push({ name: animation.id as AvatarAnimationName, label: animation.name })
    groups.set(animation.category, options)
    return groups
  }, new Map<string, Array<{ name: AvatarAnimationName; label: string }>>()),
).map(([category, options]) => ({
  label: CATEGORY_LABELS[category] ?? category,
  options,
})).sort((left, right) => {
  const leftCategory = Object.entries(CATEGORY_LABELS).find(([, label]) => label === left.label)?.[0] ?? left.label
  const rightCategory = Object.entries(CATEGORY_LABELS).find(([, label]) => label === right.label)?.[0] ?? right.label
  return CATEGORY_ORDER.indexOf(leftCategory) - CATEGORY_ORDER.indexOf(rightCategory)
})
