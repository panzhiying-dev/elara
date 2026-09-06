import type { ReactElement } from 'react'
import type { AvatarAnimationName } from '../../avatar/AvatarViewer'
import { AVATAR_ANIMATION_GROUPS } from '../../avatar/constants/animations'

/** 动画面板接收的 UI 状态与选择回调。 */
interface AnimationPanelProps {
  activeAnimation: AvatarAnimationName
  onSelect: (name: AvatarAnimationName) => void
}

/** 以分组列表展示动作，并把用户选择通知给上层 Hook。 */
export function AnimationPanel({ activeAnimation, onSelect }: AnimationPanelProps): ReactElement {
  return (
    <nav className="animation-panel" aria-label="Avatar animation test panel">
      {AVATAR_ANIMATION_GROUPS.map(({ label, options }) => (
        <section className="animation-group" key={label}>
          <h2 className="animation-group-title">{label}</h2>
          <select
            className="animation-select"
            value={options.some(({ name }) => name === activeAnimation) ? activeAnimation : ''}
            aria-label={`${label} animation`}
            onChange={(event) => {
              const selected = options.find(({ name }) => name === event.target.value)?.name
              if (selected) onSelect(selected)
            }}
          >
            <option value="" disabled>Select animation</option>
            {options.map(({ name, label: optionLabel }) => (
              <option key={name} value={name}>{optionLabel}</option>
            ))}
          </select>
        </section>
      ))}
    </nav>
  )
}
