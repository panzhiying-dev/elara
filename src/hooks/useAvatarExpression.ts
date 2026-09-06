import { useCallback, useEffect, useState, type RefObject } from 'react'
import { AvatarViewer } from '../avatar/AvatarViewer'
import type { AvatarExpressionDescriptor } from '../avatar/features/expression/AvatarExpressionFeature'

/** Expression Explorer 的激活状态与运行时切换 API。 */
export interface AvatarExpressionState {
  activeExpressions: Set<string>
  toggleExpression: (name: string) => void
}

/** 管理表达式面板状态，不复制 Avatar Runtime 的权重数据。 */
export function useAvatarExpression(
  viewerRef: RefObject<AvatarViewer | null>,
  expressions: AvatarExpressionDescriptor[],
): AvatarExpressionState {
  const [activeExpressions, setActiveExpressions] = useState<Set<string>>(new Set())

  useEffect(() => {
    setActiveExpressions(new Set())
  }, [expressions])

  const toggleExpression = useCallback((name: string): void => {
    const enabled = viewerRef.current?.toggleExpression(name) ?? false
    setActiveExpressions((current) => {
      const next = new Set(current)
      if (enabled) next.add(name)
      else next.delete(name)
      return next
    })
  }, [viewerRef])

  return { activeExpressions, toggleExpression }
}
