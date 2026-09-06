import type { ReactElement } from 'react'
import { LIP_SYNC_VISEMES } from '../../lipsync/LipSyncTypes'
import type { PresentationDebugState } from '../../avatar/features/expression/AvatarPresentationController'

/** 纯展示 Avatar Presentation 运行时状态，不参与状态修改。 */
export function PresentationDebugPanel({ presentation }: { presentation: PresentationDebugState | null }): ReactElement | null {
  if (!presentation) return null
  return (
    <aside className="presentation-debug" aria-label="Presentation debug">
      <strong>Presentation</strong>
      <div>Motion: {presentation.motion}</div>
      <div>Emotion: {presentation.emotion}</div>
      <div>Emotion Source: {presentation.emotionSource}</div>
      <div>Blink: {presentation.blink}</div>
      <div>LipSync: {presentation.mouth}</div>
      <div>LipSync Weights: {LIP_SYNC_VISEMES.map((viseme) => `${viseme}: ${(presentation.resolvedExpressions[viseme] ?? 0).toFixed(2)}`).join(' · ')}</div>
      <div>MicroExpression: {presentation.microExpression}</div>
      {presentation.actionExpression && <div>Action Override: {presentation.actionExpression}</div>}
      {presentation.conflict && <div>Conflict: {presentation.conflict}</div>}
      <div>Resolved: {Object.entries(presentation.resolvedExpressions).map(([name, weight]) => `${name}: ${weight.toFixed(2)}`).join(' · ') || 'none'}</div>
    </aside>
  )
}
