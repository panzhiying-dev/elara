import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { useLocalRuntime, type ChatModelAdapter, type ThreadMessage } from '@assistant-ui/react'
import { AvatarAudioManager } from '../audio/AvatarAudioManager'
import { ConversationRuntime } from '../runtime/conversation'
import type { AvatarViewer } from '../avatar/AvatarViewer'
import { useAvatarStore } from '../stores/avatar'

/** 从 assistant-ui 消息中提取用户文本；多段内容按顺序合并。 */
function getMessageText(message: ThreadMessage): string {
  return message.content
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('')
}

/**
 * 创建 assistant-ui Chat Runtime。
 * adapter 只负责把 Thread 消息交给 ConversationRuntime，回复音频则转交 AvatarAudioManager。
 */
export function useAssistantConversation(viewerRef: RefObject<AvatarViewer | null>) {
  const runtimeRef = useRef<ConversationRuntime | null>(null)
  const audioRef = useRef<AvatarAudioManager | null>(null)
  const generationRef = useRef(0)

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return undefined
    const runtime = new ConversationRuntime(undefined, {
      // 仅在 2 秒仍未收到文本时播放一次短暂 Thinking；正常快速响应保持 Idle。
      onThinkingStarted: () => {
        void viewer.playAnimation('thinking')
      },
      // 首个响应到达时立即清理 Thinking，后续 TTS/Chunk 再切换到 idle-talking。
      onResponseStarted: () => {
        // Dance 属于用户显式高优先级动作，不因普通对话开始而被抢占。
        viewerRef.current?.stopAnimation(true)
      },
    })
    const audio = new AvatarAudioManager(viewer, {
      onLipSync: (player) => useAvatarStore.getState().setLipSyncState(player ? 'playing' : 'idle'),
    })
    runtimeRef.current = runtime
    audioRef.current = audio
    return () => {
      runtime.cancel()
      audio.dispose()
      runtimeRef.current = null
      audioRef.current = null
    }
  }, [viewerRef])

  const adapter = useMemo<ChatModelAdapter>(() => ({
    async *run(options) {
      const latestUser = [...options.messages].reverse().find((message) => message.role === 'user')
      const content = latestUser ? getMessageText(latestUser) : ''
      const runtime = runtimeRef.current
      const audio = audioRef.current
      if (!runtime || !audio || !content.trim()) { yield { content: [{ type: 'text', text: '' }] }; return }
      const generationId = `generation-${++generationRef.current}`
      useAvatarStore.getState().setGenerationId(generationId)
      // 在首个 SSE 音频 Chunk 到达前就切断上一轮响应，避免旧语音
      // 继续占用唯一 AudioScheduler；ConversationRuntime 仍负责文本代际校验。
      audioRef.current?.beginResponseGeneration(generationId)
      const abort = (): void => {
        runtime.cancel()
        audio.stop()
        // 取消请求可能发生在 Thinking 或 Talking Gesture 期间，主动清理
        // 当前临时动作，确保 Avatar 不会停在中间 Pose。
        viewerRef.current?.stopAnimation()
      }
      options.abortSignal.addEventListener('abort', abort, { once: true })
      const updates: string[] = []
      let wake: (() => void) | null = null
      let completed = false
      let assistantText = ''
      const notify = (): void => { const resolver = wake; wake = null; resolver?.() }
      const pushUpdate = (delta: string): void => {
        assistantText += delta
        updates.push(assistantText)
        notify()
      }
      const sendPromise = (async () => {
        try {
        void audio.playInteraction('request-received', generationId)
        const result = await runtime.send(content, options.abortSignal, generationId, (chunk) => {
          void audio.enqueueStreamingChunk(chunk, (url) => runtime.resolveAssetUrl(url), generationId)
          return Promise.resolve()
        }, pushUpdate)
        audio.stopInteraction()
        if (options.abortSignal.aborted) return
        useAvatarStore.getState().setConversationId(runtime.getConversationId())
        audio.finishStreamingResponse(generationId)
        } catch (error) {
          throw error
        } finally {
          completed = true
          notify()
        }
      })()
      while (!completed || updates.length > 0) {
        if (updates.length === 0) await new Promise<void>((resolve) => { wake = resolve })
        while (updates.length > 0) yield { content: [{ type: 'text', text: updates.shift() as string }] }
      }
      try {
        await sendPromise
      } catch (error) {
        // 网络/API/TTS 异常同样必须回收 Thinking、Gesture 和 LipSync。
        viewerRef.current?.stopAnimation()
        if (!options.abortSignal.aborted) useAvatarStore.getState().setAvatarState('error')
        if (!options.abortSignal.aborted) {
          const kind = ConversationRuntime.getErrorKind(error)
          const intent = kind === 'network' ? 'network-error' : kind === 'server' ? 'server-error' : kind === 'llm' ? 'llm-error' : kind === 'tts' ? 'tts-error' : kind === 'lipsync' ? 'lipsync-error' : 'unknown-error'
          void audio.playInteraction(intent, generationId)
        }
        throw error
      } finally {
        options.abortSignal.removeEventListener('abort', abort)
      }
    },
  }), [])

  return useLocalRuntime(adapter, { unstable_queueClearOnCancel: true })
}
