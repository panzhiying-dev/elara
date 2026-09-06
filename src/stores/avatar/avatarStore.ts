import { create } from 'zustand'

/** 数字人可观察的表现状态；不包含聊天消息或输入框内容。 */
export type AvatarRuntimeState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'interrupted' | 'error'
/** 音频运行状态。 */
export type AvatarAudioState = 'idle' | 'playing' | 'error'
/** LipSync 运行状态。 */
export type AvatarLipSyncState = 'idle' | 'playing' | 'error'

/** Avatar Runtime 的唯一状态源。 */
export interface AvatarStoreState {
  /** 当前数字人状态。 */
  avatarState: AvatarRuntimeState
  /** 当前音频状态。 */
  audioState: AvatarAudioState
  /** 当前口型同步状态。 */
  lipSyncState: AvatarLipSyncState
  /** 当前情绪；后端未提供时由运行时使用默认值。 */
  emotion: string
  /** 当前动作/手势名称。 */
  gesture: string | null
  /** 当前动画名称。 */
  animation: string | null
  /** 当前有效请求 generation。 */
  generationId: string | null
  /** 当前音频任务 ID。 */
  currentTaskId: string | null
  /** 当前会话只读镜像，聊天内容仍由 assistant-ui 管理。 */
  currentConversationId: string | null
  /** 设置数字人状态。 */
  setAvatarState: (state: AvatarRuntimeState) => void
  /** 设置音频状态。 */
  setAudioState: (state: AvatarAudioState) => void
  /** 设置 LipSync 状态。 */
  setLipSyncState: (state: AvatarLipSyncState) => void
  /** 设置情绪。 */
  setEmotion: (emotion: string) => void
  /** 设置动作/手势。 */
  setGesture: (gesture: string | null) => void
  /** 设置当前动画。 */
  setAnimation: (animation: string | null) => void
  /** 设置 generation。 */
  setGenerationId: (generationId: string | null) => void
  /** 设置当前任务 ID。 */
  setCurrentTaskId: (taskId: string | null) => void
  /** 设置当前会话镜像。 */
  setConversationId: (conversationId: string | null) => void
  /** 恢复空闲状态并清理本轮任务引用。 */
  resetAvatarState: () => void
}

/**
 * Zustand Avatar Runtime Store。
 * 该 Store 只记录数字人的执行状态，避免与 assistant-ui 的 Thread 状态重复。
 */
export const useAvatarStore = create<AvatarStoreState>((set) => ({
  avatarState: 'idle', audioState: 'idle', lipSyncState: 'idle', emotion: 'neutral', gesture: null, animation: null,
  generationId: null, currentTaskId: null, currentConversationId: null,
  setAvatarState: (avatarState) => set({ avatarState }), setAudioState: (audioState) => set({ audioState }),
  setLipSyncState: (lipSyncState) => set({ lipSyncState }), setEmotion: (emotion) => set({ emotion }),
  setGesture: (gesture) => set({ gesture }), setAnimation: (animation) => set({ animation }),
  setGenerationId: (generationId) => set({ generationId }), setCurrentTaskId: (currentTaskId) => set({ currentTaskId }),
  setConversationId: (currentConversationId) => set({ currentConversationId }),
  resetAvatarState: () => set({ avatarState: 'idle', audioState: 'idle', lipSyncState: 'idle', gesture: null, animation: null, currentTaskId: null }),
}))
