import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { AvatarViewer } from '../avatar/AvatarViewer'
import { LipSyncPlayer } from '../lipsync/LipSyncPlayer'
import { isLipSyncDocument } from '../lipsync/LipSyncValidator'
import { AudioPlaybackManager } from '../audio/AudioPlaybackManager'
import { AudioScheduler } from '../audio/AudioScheduler'
import type { AudioTask } from '../audio/audio.types'

/** LipSync 面板所需的音频元素、加载状态和播放操作。 */
export interface LipSyncState {
  audioRef: RefObject<HTMLAudioElement | null>
  ready: boolean
  playing: boolean
  play: () => void
}

/** 管理 LipSync 文档、播放器和音频事件，并绑定到 AvatarViewer。 */
export function useLipSync(viewerRef: RefObject<AvatarViewer | null>): LipSyncState {
  const audioRef = useRef<HTMLAudioElement>(null)
  const playerRef = useRef<LipSyncPlayer | null>(null)
  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const schedulerRef = useRef<AudioScheduler | null>(null)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return undefined

    let disposed = false
    const scheduler = new AudioScheduler(new AudioPlaybackManager(audio))
    schedulerRef.current = scheduler
    const loadLipSync = async (): Promise<void> => {
      try {
        const response = await fetch('/models/audio/elara-greeting/lipsync.json')
        if (!response.ok) throw new Error(`LipSync JSON request failed: ${response.status}`)
        const value: unknown = await response.json()
        if (!isLipSyncDocument(value)) throw new Error('LipSync JSON format is invalid')
        if (disposed) return

        const player = new LipSyncPlayer(value)
        playerRef.current = player
        viewerRef.current?.setLipSyncPlayer(player, () => audio.currentTime)
        setReady(true)
      } catch (error) {
        console.error('LipSync test data failed to load', error)
      }
    }

    void loadLipSync()
    const handleEnded = (): void => {
      const player = playerRef.current
      player?.reset()
      if (player) viewerRef.current?.setLipSyncPlayer(player, () => audio.currentTime)
      setPlaying(false)
    }
    const handleAudioError = (): void => {
      console.error('LipSync test audio failed to load')
      setPlaying(false)
    }
    audio.addEventListener('ended', handleEnded)
    audio.addEventListener('error', handleAudioError)

    return () => {
      disposed = true
      audio.pause()
      scheduler.dispose()
      schedulerRef.current = null
      audio.removeEventListener('ended', handleEnded)
      audio.removeEventListener('error', handleAudioError)
      playerRef.current?.reset()
      viewerRef.current?.setLipSyncPlayer(null)
      playerRef.current = null
    }
  }, [viewerRef])

  const play = useCallback((): void => {
    const audio = audioRef.current
    const player = playerRef.current
    if (!audio || !ready) return
    audio.currentTime = 0
    player?.reset()
    player?.play()
    const task: AudioTask = {
      id: `debug-lipsync-${Date.now()}`, type: 'interaction', priority: 'LOW', status: 'queued', createdAt: Date.now(),
      audioUrl: audio.currentSrc || audio.src, conversationId: null, requestId: null, generationId: 'debug-lipsync', cancellable: true, interruptible: true,
      onComplete: () => setPlaying(false), onCancel: () => setPlaying(false), onError: () => setPlaying(false),
    }
    void schedulerRef.current?.enqueue(task).catch((error: unknown) => console.error('LipSync audio failed to play', error))
    setPlaying(true)
  }, [ready])

  return { audioRef, ready, playing, play }
}
