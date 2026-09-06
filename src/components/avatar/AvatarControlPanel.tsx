import type { ReactElement } from 'react'
import type { AvatarAnimationName } from '../../avatar/AvatarViewer'
import type { AvatarExpressionDescriptor } from '../../avatar/features/expression/AvatarExpressionFeature'
import { AnimationPanel } from './AnimationPanel'
import { ExpressionPanel } from './ExpressionPanel'
import { ModelSelector } from './ModelSelector'
import type { ModelTransitionState } from '../../avatar/transition'

/** 控制面板组合组件所需的动作与表情 UI 状态。 */
interface AvatarControlPanelProps {
  activeAnimation: AvatarAnimationName
  onSelectAnimation: (name: AvatarAnimationName) => void
  expressions: AvatarExpressionDescriptor[]
  activeExpressions: Set<string>
  onToggleExpression: (name: string) => void
  currentModelId: string | null
  transitionState: ModelTransitionState
  onSelectModel: (modelId: string) => void
}

/** 组合动作与表情控制面板，不持有 Avatar Runtime 生命周期。 */
export function AvatarControlPanel(props: AvatarControlPanelProps): ReactElement {
  return (
    <>
      <ModelSelector
        currentModelId={props.currentModelId}
        transitionState={props.transitionState}
        onSelect={props.onSelectModel}
      />
      <AnimationPanel activeAnimation={props.activeAnimation} onSelect={props.onSelectAnimation} />
      <ExpressionPanel expressions={props.expressions} activeExpressions={props.activeExpressions} onToggle={props.onToggleExpression} />
    </>
  )
}
