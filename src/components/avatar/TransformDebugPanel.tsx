import { useEffect, useState, type ReactElement, type RefObject } from 'react'
import type { AvatarTransformDebugState } from '../../avatar/AvatarViewer'
import type { AvatarViewer } from '../../avatar/AvatarViewer'

function formatVector(vector: { x: number; y: number; z: number }): string {
  return `x ${vector.x.toFixed(3)} · y ${vector.y.toFixed(3)} · z ${vector.z.toFixed(3)}`
}

/** 只读显示模型构图参数，便于更换背景时校准初始位置。 */
export function TransformDebugPanel({ viewerRef }: { viewerRef: RefObject<AvatarViewer | null> }): ReactElement {
  const [state, setState] = useState<AvatarTransformDebugState | null>(null)

  useEffect(() => {
    let disposed = false
    const sample = (): void => {
      if (disposed) return
      setState(viewerRef.current?.getTransformDebugState() ?? null)
    }
    sample()
    const timer = window.setInterval(sample, 100)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [viewerRef])

  return (
    <aside className="transform-debug" aria-label="Avatar transform debug">
      <strong>Transform</strong>
      {state ? <>
        <div>Model Position: {formatVector(state.modelPosition)}</div>
        <div>Model Rotation: {formatVector(state.modelRotation)}</div>
        <div>Model Scale: {formatVector(state.modelScale)}</div>
        <div>Model Size: {formatVector(state.modelSize)}</div>
        <div>Camera Position: {formatVector(state.cameraPosition)}</div>
        <div>Camera Target: {formatVector(state.cameraTarget)}</div>
      </> : <div>Model loading…</div>}
    </aside>
  )
}
