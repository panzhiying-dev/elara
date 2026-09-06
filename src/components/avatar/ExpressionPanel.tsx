import type { ReactElement } from 'react'
import type { AvatarExpressionDescriptor } from '../../avatar/features/expression/AvatarExpressionFeature'

/** 表情面板接收的只读描述、激活状态和切换回调。 */
interface ExpressionPanelProps {
  expressions: AvatarExpressionDescriptor[]
  activeExpressions: Set<string>
  onToggle: (name: string) => void
}

/** 按 Expression 类别渲染按钮，不直接依赖 AvatarViewer 内部实现。 */
export function ExpressionPanel({ expressions, activeExpressions, onToggle }: ExpressionPanelProps): ReactElement {
  return (
    <nav className="expression-panel" aria-label="Avatar expression explorer">
      <h2 className="animation-group-title">Expressions ({expressions.length})</h2>
      {(['Emotion', 'Blink', 'Mouth', 'Other'] as const).map((category) => {
        const categoryExpressions = expressions.filter((expression) => expression.category === category)
        if (categoryExpressions.length === 0) return null
        return (
          <section className="animation-group" key={category}>
            <h3 className="animation-group-title">{category}</h3>
            <div className="animation-group-buttons">
              {categoryExpressions.map(({ name }) => (
                <button key={name} type="button" className="animation-button" aria-pressed={activeExpressions.has(name)} onClick={() => onToggle(name)}>
                  {name}
                </button>
              ))}
            </div>
          </section>
        )
      })}
    </nav>
  )
}
