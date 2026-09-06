import type { ReactElement } from 'react'
import { ComposerPrimitive, MessagePrimitive, ThreadPrimitive, useAuiState } from '@assistant-ui/react'
import type { AssistantRuntime } from '@assistant-ui/react'
import { useAvatarStore } from '../stores/avatar'

/** 使用 assistant-ui primitives 渲染消息内容，消息状态不在 React 本地复制。 */
function MessageBody(): ReactElement {
  return <><span className="message-role"><MessagePrimitive.If assistant>Elara</MessagePrimitive.If><MessagePrimitive.If user>你</MessagePrimitive.If></span><MessagePrimitive.Content /><MessagePrimitive.Error /></>
}

function Message(): ReactElement {
  return <>
    <MessagePrimitive.If user><MessagePrimitive.Root className="message-bubble message-user"><MessageBody /></MessagePrimitive.Root></MessagePrimitive.If>
    <MessagePrimitive.If assistant><MessagePrimitive.Root className="message-bubble message-assistant"><MessageBody /></MessagePrimitive.Root></MessagePrimitive.If>
    <MessagePrimitive.If system><MessagePrimitive.Root className="message-bubble"><MessageBody /></MessagePrimitive.Root></MessagePrimitive.If>
  </>
}

/** 极简响应区与底部 Composer；消息生命周期仍完全由 assistant-ui Runtime 管理。 */
export function ConversationPanel({ runtime }: { runtime: AssistantRuntime }): ReactElement {
  const isRunning = useAuiState((state) => state.thread.isRunning)
  const messageCount = useAuiState((state) => state.thread.messages.length)
  const avatarState = useAvatarStore((state) => state.avatarState)
  const presenceLabel = avatarState === 'listening' ? 'Listening' : avatarState === 'thinking' ? 'Thinking...' : avatarState === 'speaking' ? 'Speaking' : avatarState === 'error' ? '暂时遇到问题' : null
  return (
    <section className="conversation-layer" aria-label="Elara conversation">
      {presenceLabel && <div className={`presence-status is-${avatarState}`} aria-live="polite"><i /><span>{presenceLabel}</span></div>}
      <ThreadPrimitive.Root className="assistant-thread">
        <ThreadPrimitive.Viewport className="message-list">
          {messageCount === 0 ? (
            <div className="conversation-welcome"><p>你好呀，我是 Elara。</p><span>今天想和我聊点什么？</span></div>
          ) : (
            <>
              <ThreadPrimitive.MessageByIndex index={Math.max(messageCount - 2, 0)} components={{ Message }} />
              {messageCount > 1 && <ThreadPrimitive.MessageByIndex index={messageCount - 1} components={{ Message }} />}
            </>
          )}
        </ThreadPrimitive.Viewport>
        <ComposerPrimitive.Root className="message-composer">
          <ComposerPrimitive.Input className="composer-input" placeholder="和 Elara 说点什么……" rows={1} aria-label="和 Elara 说点什么" />
          {isRunning ? <ComposerPrimitive.Cancel className="composer-send-button" aria-label="停止生成" title="停止生成"><span aria-hidden="true">■</span></ComposerPrimitive.Cancel> : <ComposerPrimitive.Send className="composer-send-button" aria-label="发送" title="发送"><span aria-hidden="true">↑</span></ComposerPrimitive.Send>}
        </ComposerPrimitive.Root>
      </ThreadPrimitive.Root>
      <small className="composer-hint">Enter 发送 · Shift + Enter 换行</small>
    </section>
  )
}
