import { useCallback, useState, type RefObject } from 'react'
import { AvatarViewer, type AvatarAnimationName } from '../avatar/AvatarViewer'

/** 动画选择状态与 AvatarViewer 播放 API 的 UI 适配层。 */
export interface AvatarAnimationState {
  activeAnimation: AvatarAnimationName
  selectAnimation: (name: AvatarAnimationName) => void
}

/** 管理当前面板选择，并将用户选择转发给 AvatarViewer。 */
export function useAvatarAnimation(
  viewerRef: RefObject<AvatarViewer | null>,
): AvatarAnimationState {
  const [activeAnimation, setActiveAnimation] = useState<AvatarAnimationName>('modelPose')

  const selectAnimation = useCallback((name: AvatarAnimationName): void => {
    setActiveAnimation(name)
    void viewerRef.current?.playAnimation(name)
  }, [viewerRef])

  return { activeAnimation, selectAnimation }
}
