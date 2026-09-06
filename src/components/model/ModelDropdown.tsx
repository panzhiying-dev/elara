import type { ReactElement } from 'react'
import { listModels } from '../../Model'
import type { ModelTransitionState } from '../../avatar/transition'

/** 顶部模型下拉框的属性。 */
interface ModelDropdownProps {
  /** 当前模型 ID。 */
  currentModelId: string | null
  /** 模型切换生命周期状态。 */
  transitionState: ModelTransitionState
  /** 选择模型后的回调。 */
  onSelect: (modelId: string) => void
}

/** 复用 Model Registry，避免 UI 维护第二份模型清单。 */
export function ModelDropdown({ currentModelId, transitionState, onSelect }: ModelDropdownProps): ReactElement {
  const disabled = transitionState === 'exiting' || transitionState === 'loading' || transitionState === 'entering'
  return (
    <label className="topbar-select-wrap">
      <span className="sr-only">选择 Avatar 模型</span>
      <select
        className="topbar-select"
        value={currentModelId ?? ''}
        disabled={disabled || !currentModelId}
        onChange={(event) => onSelect(event.target.value)}
        aria-label="选择 Avatar 模型"
      >
        {!currentModelId && <option value="">加载中…</option>}
        {listModels().map((model) => <option value={model.id} key={model.id}>{model.name}</option>)}
      </select>
    </label>
  )
}
