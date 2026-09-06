import { useEffect, useRef, useState, type RefObject } from 'react'
import { AvatarViewer } from '../avatar/AvatarViewer'
import type { AvatarExpressionDescriptor } from '../avatar/features/expression/AvatarExpressionFeature'
import type { PresentationDebugState } from '../avatar/features/expression/AvatarPresentationController'
import type { ModelTransitionChange, ModelTransitionState } from '../avatar/transition'

/** AvatarViewer 与 React UI 之间的生命周期桥接结果。 */
export interface AvatarViewerRuntime {
  containerRef: RefObject<HTMLDivElement | null>
  viewerRef: RefObject<AvatarViewer | null>
  expressions: AvatarExpressionDescriptor[]
  presentation: PresentationDebugState | null
  currentModelId: string | null
  transitionState: ModelTransitionState
  transitionTargetModelId: string | null
  transitionError: Error | null
  switchModel: (modelId: string) => void
  playAnimation: (name: string) => void
  /** 主动取消当前动作并恢复持续 Idle。 */
  stopAnimation: () => void
  getCanvas: () => HTMLCanvasElement | null
}

/** 创建、加载和销毁 AvatarViewer，并同步 UI 真正需要的只读状态。 */
export function useAvatarViewer(): AvatarViewerRuntime {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<AvatarViewer | null>(null)
  const [expressions, setExpressions] = useState<AvatarExpressionDescriptor[]>([])
  const [presentation, setPresentation] = useState<PresentationDebugState | null>(null)
  const [currentModelId, setCurrentModelId] = useState<string | null>(null)
  const [transitionState, setTransitionState] = useState<ModelTransitionState>('ready')
  const [transitionTargetModelId, setTransitionTargetModelId] = useState<string | null>(null)
  const [transitionError, setTransitionError] = useState<Error | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return undefined

    const viewer = new AvatarViewer(container, {
      entrance: false,
      onExpressionsChanged: setExpressions,
      onPresentationChanged: setPresentation,
      onTransitionChanged: (change: ModelTransitionChange) => {
        setCurrentModelId(change.currentModelId)
        setTransitionState(change.state)
        setTransitionTargetModelId(change.targetModelId)
        setTransitionError(change.error)
      },
    })
    viewerRef.current = viewer
    void viewer.load().then(() => {
      setCurrentModelId(viewer.getModelManager().getCurrentModelId())
    }).catch((error: unknown) => {
      setTransitionError(error instanceof Error ? error : new Error(String(error)))
    })

    return () => {
      viewer.setLipSyncPlayer(null)
      viewer.dispose()
      if (viewerRef.current === viewer) viewerRef.current = null
    }
  }, [])

  const switchModel = (modelId: string): void => {
    void viewerRef.current?.switchModel(modelId).catch((error: unknown) => {
      setTransitionError(error instanceof Error ? error : new Error(String(error)))
    })
  }

  const playAnimation = (name: string): void => {
    void viewerRef.current?.playAnimation(name)
  }

  const stopAnimation = (): void => {
    viewerRef.current?.stopAnimation()
  }

  const getCanvas = (): HTMLCanvasElement | null => viewerRef.current?.getCanvas() ?? null

  return {
    containerRef,
    viewerRef,
    expressions,
    presentation,
    currentModelId,
    transitionState,
    transitionTargetModelId,
    transitionError,
    switchModel,
    playAnimation,
    stopAnimation,
    getCanvas,
  }
}
