import type { ReactElement } from 'react'
import type { AvatarAnimationName } from '../../avatar/AvatarViewer'
import { selectAnimations } from '../../avatar/policies'

/** Camera Mode 中可触发的动作配置，动画资源仍由 AnimationManager 解析。 */
export interface AvatarAction {
  /** 动作唯一标识。 */
  id: string
  /** 面向用户的名称。 */
  name: string
  /** 可选图标。 */
  icon: string
  /** 已注册 VRMA 动作 ID。 */
  animation: AvatarAnimationName
}

/** 第一阶段动作快捷入口，全部映射到现有 VRMA Registry。 */
/** 摄像模式只展示 Policy 白名单中的基础、Pose 和 Dance 动作。 */
const CAMERA_ICONS: Record<string, string> = {
  idle: '🧍', showFullBody: '🧍', modelPose: '✨', SambaDancing: '💃',
  ArmsHipHopDance: '💃', HipHopDancing: '💃', StepHipHopDance: '💃',
  TutHipHopDance: '💃', hipHopDancingVariant: '💃',
}

/** 由 Registry + Camera Policy 生成动作列表，避免手工把 response/action 混入 Camera。 */
export const CAMERA_ACTIONS: readonly AvatarAction[] = selectAnimations('camera')
  .map((animation) => ({
    id: animation.id,
    name: animation.id === 'idle' ? '待机' : animation.name,
    icon: CAMERA_ICONS[animation.id] ?? '🎭',
    animation: animation.id,
  }))

/** 右侧浮动动作面板，只负责选择并通知上层 Action。 */
export function ActionPanel({ activeActionId, onSelect }: { activeActionId: string | null; onSelect: (action: AvatarAction) => void }): ReactElement {
  return (
    <aside className="action-panel" aria-label="Avatar 动作">
      <h2>动作</h2>
      <div className="action-list">
        {CAMERA_ACTIONS.map((action) => (
          <button type="button" key={action.id} className={`action-item${activeActionId === action.id ? ' is-active' : ''}`} aria-pressed={activeActionId === action.id} onClick={() => onSelect(action)}>
            <span aria-hidden="true">{action.icon}</span><span>{action.name}</span>
          </button>
        ))}
      </div>
    </aside>
  )
}
