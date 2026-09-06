import { useEffect, useRef, useState, type ReactElement } from 'react'
import { AvatarStage } from '../components/avatar/AvatarStage'
import { ConversationPanel } from '../components/ConversationPanel'
import { ModelDropdown } from '../components/model/ModelDropdown'
import type { AvatarAction } from '../components/camera/ActionPanel'
import { CameraMode } from '../components/camera/CameraMode'
import { useAvatarViewer } from '../hooks/useAvatarViewer'
import { useAssistantConversation } from '../hooks/useAssistantConversation'
import { AssistantRuntimeProvider } from '@assistant-ui/react'
import { PhotoCaptureService } from '../services/PhotoCaptureService'
import {
  ScreenRecordingService,
  type RecordingState,
} from '../services/ScreenRecordingService'
import { selectAnimation } from '../avatar/policies'
// import { TransformDebugPanel } from '../components/avatar/TransformDebugPanel'

/** Elara 极简陪伴首页：全屏 Avatar、轻量响应和底部 Composer。 */
export function App(): ReactElement {
  const avatar = useAvatarViewer()
  const conversationRuntime = useAssistantConversation(avatar.viewerRef)
  const [appMode, setAppMode] = useState<'avatar' | 'camera'>('avatar')
  const [recordingState, setRecordingState] = useState<RecordingState>('idle')
  const [recordingDuration, setRecordingDuration] = useState(0)
  const [recordingStartedAt, setRecordingStartedAt] = useState<number | null>(
    null,
  )
  const [recordingError, setRecordingError] = useState<string | null>(null)
  const [activeActionId, setActiveActionId] = useState<string | null>('idle')
  const recordingRef = useRef<ScreenRecordingService | null>(null)
  const photoRef = useRef(new PhotoCaptureService())

  useEffect(() => {
    const service = new ScreenRecordingService(({ state, error }) => {
      setRecordingState(state)
      setRecordingError(error?.message ?? null)
      if (state === 'recording') setRecordingStartedAt(performance.now())
      if (state === 'idle' || state === 'completed' || state === 'error')
        setRecordingStartedAt(null)
    })
    recordingRef.current = service
    return () => {
      service.dispose()
      recordingRef.current = null
    }
  }, [])

  useEffect(() => {
    if (recordingStartedAt === null) {
      setRecordingDuration(0)
      return undefined
    }
    let frame = 0
    const update = (): void => {
      setRecordingDuration(performance.now() - recordingStartedAt)
      frame = window.requestAnimationFrame(update)
    }
    frame = window.requestAnimationFrame(update)
    return () => window.cancelAnimationFrame(frame)
  }, [recordingStartedAt])

  const startRecording = async (): Promise<void> => {
    setRecordingError(null)
    await recordingRef.current?.start()
  }

  const stopRecording = async (): Promise<void> => {
    await recordingRef.current?.stopAndDownload()
  }

  const capturePhoto = async (): Promise<void> => {
    const canvas = avatar.getCanvas()
    if (!canvas) {
      setRecordingError('Avatar 画面尚未准备好，暂时无法拍照。')
      return
    }
    try {
      await photoRef.current.captureAndDownload(canvas)
    } catch (error) {
      setRecordingError(
        error instanceof Error ? error.message : '拍照失败，请稍后重试。',
      )
    }
  }

  const selectAction = (action: AvatarAction): void => {
    // UI Action 仍需经过 Camera Policy 二次校验，防止未来外部调用绕过白名单。
    if (!selectAnimation(action.animation, 'camera')) return
    setActiveActionId(action.id)
    avatar.playAnimation(action.animation)
  }

  return (
    <main className="elara-app">
      <section className="avatar-stage" aria-label="Elara avatar stage">
        <AvatarStage containerRef={avatar.containerRef} />
      </section>
      {/* {appMode === 'avatar' && (
        <TransformDebugPanel viewerRef={avatar.viewerRef} />
      )} */}
      {appMode === 'avatar' && (
        <header className="app-topbar">
          <div className="brand-mark">
            <span className="brand-orb" />
            Elara
          </div>
          <div className="topbar-actions">
            <ModelDropdown
              currentModelId={avatar.currentModelId}
              transitionState={avatar.transitionState}
              onSelect={avatar.switchModel}
            />
            <button
              type="button"
              className="topbar-camera-button"
              onClick={() => setAppMode('camera')}
            >
              📷 Camera
            </button>
          </div>
        </header>
      )}
      {appMode === 'camera' && (
        <CameraMode
          recordingState={recordingState}
          recordingDuration={recordingDuration}
          activeActionId={activeActionId}
          errorMessage={recordingError}
          onExit={() => setAppMode('avatar')}
          onPhoto={() => void capturePhoto()}
          onRecord={() => void startRecording()}
          onStop={() => void stopRecording()}
          onAction={selectAction}
        />
      )}
      <AssistantRuntimeProvider runtime={conversationRuntime}>
        {appMode === 'avatar' && (
          <ConversationPanel runtime={conversationRuntime} />
        )}
      </AssistantRuntimeProvider>
    </main>
  )
}
