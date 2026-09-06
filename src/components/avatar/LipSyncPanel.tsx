import type { ReactElement, RefObject } from 'react'

interface LipSyncPanelProps {
  audioRef: RefObject<HTMLAudioElement | null>
  ready: boolean
  playing: boolean
  onPlay: () => void
}

/** 只展示 LipSync 的加载与播放控制，播放器生命周期由 useLipSync 管理。 */
export function LipSyncPanel({ audioRef, ready, playing, onPlay }: LipSyncPanelProps): ReactElement {
  return (
    <section className="lipsync-panel" aria-label="LipSync test panel">
      <strong>LipSync</strong>
      <button type="button" className="animation-button" disabled={!ready} onClick={onPlay}>
        {playing ? 'Playing…' : 'Play greeting LipSync'}
      </button>
      {!ready && <small>Loading test timeline…</small>}
      <audio ref={audioRef} data-lipsync-test src="/models/audio/elara-greeting/audio.wav" preload="auto" />
    </section>
  )
}
