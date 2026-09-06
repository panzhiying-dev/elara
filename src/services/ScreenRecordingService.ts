/** 浏览器屏幕录制生命周期。 */
export type RecordingState = 'idle' | 'requesting' | 'recording' | 'stopping' | 'completed' | 'error'

/** 屏幕录制状态通知。 */
export interface RecordingStateChange {
  /** 当前状态。 */
  state: RecordingState
  /** 面向用户的中文错误。 */
  error: Error | null
}

/**
 * 只录制用户选择的屏幕、窗口或标签页，不请求任何音频轨道。
 * 生命周期由 Camera Mode 持有，dispose 会停止轨道并清理 Recorder 引用。
 */
export class ScreenRecordingService {
  private recorder: MediaRecorder | null = null
  private stream: MediaStream | null = null
  private chunks: Blob[] = []
  private stopPromise: Promise<Blob | null> | null = null
  private stopResolve: ((blob: Blob | null) => void) | null = null
  private state: RecordingState = 'idle'
  private disposed = false
  private endingFromTrack = false
  private readonly onStateChanged: ((change: RecordingStateChange) => void) | undefined

  public constructor(onStateChanged?: (change: RecordingStateChange) => void) {
    this.onStateChanged = onStateChanged
  }

  /** 当前录制状态。 */
  public getState(): RecordingState { return this.state }

  /** 请求屏幕共享并开始无音频 WebM 录制。必须由用户点击事件调用。 */
  public async start(): Promise<void> {
    if (this.disposed || this.state === 'recording' || this.state === 'requesting') return
    if (!navigator.mediaDevices?.getDisplayMedia) {
      this.fail(new Error('当前浏览器不支持屏幕录制。'))
      return
    }
    if (typeof MediaRecorder === 'undefined') {
      this.fail(new Error('当前浏览器不支持视频录制。'))
      return
    }

    this.setState('requesting')
    try {
      const sharedStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      if (this.disposed) {
        sharedStream.getTracks().forEach((track) => track.stop())
        return
      }
      const videoTrack = sharedStream.getVideoTracks()[0]
      if (!videoTrack) {
        sharedStream.getTracks().forEach((track) => track.stop())
        throw new Error('没有获取到可录制的视频画面。')
      }
      this.stream = new MediaStream([videoTrack])
      sharedStream.getAudioTracks().forEach((track) => track.stop())
      videoTrack.addEventListener('ended', this.handleTrackEnded)
      const mimeType = getSupportedMimeType()
      this.recorder = mimeType ? new MediaRecorder(this.stream, { mimeType }) : new MediaRecorder(this.stream)
      this.chunks = []
      this.recorder.addEventListener('dataavailable', this.handleData)
      this.recorder.addEventListener('stop', this.handleRecorderStop)
      this.recorder.addEventListener('error', this.handleRecorderError)
      this.recorder.start()
      this.setState('recording')
    } catch (reason) {
      this.cleanupStream()
      if (isUserCancellation(reason)) this.setState('idle')
      else this.fail(new Error('无法开始屏幕录制，请检查浏览器权限。'))
    }
  }

  /** 停止录制并返回无音频 WebM Blob；重复调用会复用同一个 Promise。 */
  public stop(): Promise<Blob | null> {
    if (this.stopPromise) return this.stopPromise
    const recorder = this.recorder
    if (!recorder || recorder.state === 'inactive') return Promise.resolve(null)
    this.setState('stopping')
    this.stopPromise = new Promise<Blob | null>((resolve) => { this.stopResolve = resolve })
    recorder.stop()
    return this.stopPromise
  }

  /** 停止录制并下载 WebM；下载触发后再释放 Object URL。 */
  public async stopAndDownload(): Promise<void> {
    const blob = await this.stop()
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `avatar-recording-${formatTimestamp()}.webm`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  /** 释放 MediaStream、事件监听和录制缓存。 */
  public dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const recorder = this.recorder
    if (recorder && recorder.state !== 'inactive') recorder.stop()
    this.cleanupStream()
    this.recorder = null
    this.chunks = []
    this.stopResolve?.(null)
    this.stopResolve = null
    this.stopPromise = null
    this.setState('idle')
  }

  private readonly handleData = (event: BlobEvent): void => {
    if (event.data.size > 0) this.chunks.push(event.data)
  }

  private readonly handleRecorderStop = (): void => {
    const blob = this.chunks.length > 0 ? new Blob(this.chunks, { type: this.recorder?.mimeType || 'video/webm' }) : null
    this.cleanupStream()
    this.recorder = null
    this.chunks = []
    this.stopResolve?.(blob)
    this.stopResolve = null
    this.stopPromise = null
    if (!this.disposed) this.setState(blob ? 'completed' : (this.endingFromTrack ? 'idle' : 'error'), blob ? null : new Error('没有生成有效的视频数据。'))
    this.endingFromTrack = false
  }

  private readonly handleRecorderError = (): void => {
    this.cleanupStream()
    this.recorder = null
    this.chunks = []
    this.stopResolve?.(null)
    this.stopResolve = null
    this.stopPromise = null
    if (!this.disposed) this.fail(new Error('录制过程中发生错误，视频未能保存。'))
  }

  private readonly handleTrackEnded = (): void => {
    if (this.state !== 'recording' || !this.recorder) return
    this.endingFromTrack = true
    void this.stop()
  }

  private cleanupStream(): void {
    const stream = this.stream
    stream?.getVideoTracks().forEach((track) => {
      track.removeEventListener('ended', this.handleTrackEnded)
      track.stop()
    })
    stream?.getAudioTracks().forEach((track) => track.stop())
    this.stream = null
  }

  private fail(error: Error): void { this.setState('error', error) }

  private setState(state: RecordingState, error: Error | null = null): void {
    this.state = state
    this.onStateChanged?.({ state, error })
  }
}

/** 按浏览器能力选择 WebM 编码，不强制 MP4。 */
function getSupportedMimeType(): string | null {
  const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
  return candidates.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? null
}

/** 用户在系统共享面板主动取消时不显示底层 DOMException。 */
function isUserCancellation(reason: unknown): boolean {
  return reason instanceof DOMException && (reason.name === 'AbortError' || reason.name === 'NotAllowedError')
}

/** 生成 YYYYMMDD-HHmmss 文件名时间片段。 */
function formatTimestamp(date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}
