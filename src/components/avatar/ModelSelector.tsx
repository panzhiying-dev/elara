import type { ReactElement } from 'react'
import { listModels } from '../../Model'
import type { ModelTransitionState } from '../../avatar/transition'

/** ModelSelector 的输入属性。 */
interface ModelSelectorProps {
  /** 当前模型 ID。 */
  currentModelId: string | null
  /** 当前过渡状态。 */
  transitionState: ModelTransitionState
  /** 切换模型回调。 */
  onSelect: (modelId: string) => void
}

/** 从 Model Registry 渲染模型列表，并在过渡期间禁用重复操作。 */
export function ModelSelector({
  currentModelId,
  transitionState,
  onSelect,
}: ModelSelectorProps): ReactElement {
  const isSwitching = transitionState === 'exiting' || transitionState === 'loading' || transitionState === 'entering'
  const statusLabel = {
    exiting: '正在离场…',
    loading: '正在加载…',
    entering: '正在入场…',
    error: '切换失败',
    ready: '',
  }[transitionState]

  return (
    <section className="model-selector" aria-label="Avatar model selector">
      <div className="model-selector-header">
        <strong>Models</strong>
        {statusLabel && <small role="status">{statusLabel}</small>}
      </div>
      <div className="model-selector-options">
        {listModels().map((model) => (
          <button
            type="button"
            className="animation-button"
            key={model.id}
            disabled={!currentModelId || isSwitching || currentModelId === model.id}
            aria-pressed={currentModelId === model.id}
            onClick={() => onSelect(model.id)}
          >
            {model.name}
          </button>
        ))}
      </div>
    </section>
  )
}
