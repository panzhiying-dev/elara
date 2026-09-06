import type { ReactElement, RefObject } from 'react'

/** AvatarStage 只提供 AvatarViewer 挂载 WebGL canvas 的 DOM 容器。 */
export function AvatarStage({ containerRef }: { containerRef: RefObject<HTMLDivElement | null> }): ReactElement {
  return <div ref={containerRef} className="avatar-container" aria-label="Aether avatar viewer" />
}
