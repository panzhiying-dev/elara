import type { ReactElement } from 'react'
import { ActionPanel, type AvatarAction } from './ActionPanel'
import type { RecordingState } from '../../services/ScreenRecordingService'

/** Camera Mode 的控制属性。 */
interface CameraModeProps {
  recordingState: RecordingState
  recordingDuration: number
  activeActionId: string | null
  errorMessage: string | null
  onExit: () => void
  onPhoto: () => void
  onRecord: () => void
  onStop: () => void
  onAction: (action: AvatarAction) => void
}

/** 摄像模式 UI；不创建任何新的 Three.js Runtime。 */
export function CameraMode({ recordingState, recordingDuration, activeActionId, errorMessage, onExit, onPhoto, onRecord, onStop, onAction }: CameraModeProps): ReactElement {
  const isRecording = recordingState === 'recording' || recordingState === 'stopping' || recordingState === 'requesting'
  return (
    <div className="camera-ui" aria-label="摄像模式">
      <header className="camera-topbar">
        <button type="button" className="camera-exit-button" onClick={onExit}>← 退出摄像模式</button>
        {isRecording && <span className="recording-indicator"><i /> REC {formatDuration(recordingDuration)}</span>}
      </header>
      <ActionPanel activeActionId={activeActionId} onSelect={onAction} />
      <div className="camera-bottom-controls">
        {errorMessage && <p className="camera-error" role="alert">{errorMessage}</p>}
        <div className="camera-control-buttons">
          <button type="button" className="camera-control-button" onClick={onPhoto} disabled={isRecording}>📷 拍照</button>
          {recordingState === 'recording' ? <button type="button" className="camera-control-button is-recording" onClick={onStop}>■ 停止录制</button> : <button type="button" className="camera-control-button" onClick={onRecord} disabled={recordingState === 'requesting' || recordingState === 'stopping'}>{recordingState === 'requesting' ? '加载中…' : recordingState === 'stopping' ? '处理中…' : '🎥 录制'}</button>}
        </div>
      </div>
    </div>
  )
}

/** 用 performance.now() 计算的实际录制时长。 */
function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}
