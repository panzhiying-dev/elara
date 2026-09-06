import {
  LIP_SYNC_VISEMES,
  type LipSyncDocument,
  type LipSyncViseme,
  type LipSyncWeights,
} from './LipSyncTypes'

const EMPTY_WEIGHTS: LipSyncWeights = {
  aa: 0,
  ih: 0,
  ou: 0,
  ee: 0,
  oh: 0,
}

/** 根据外部时间读取五个 viseme 权重；不拥有音频、计时器或渲染循环。 */
export class LipSyncPlayer {
  private readonly document: LipSyncDocument
  private readonly weights: LipSyncWeights = { ...EMPTY_WEIGHTS }
  private active = false

  public constructor(document: LipSyncDocument) {
    this.document = document
  }

  public play(): void { this.active = true }
  public pause(): void { this.active = false }

  public reset(): void {
    this.active = false
    LIP_SYNC_VISEMES.forEach((viseme) => { this.weights[viseme] = 0 })
  }

  public update(currentTime: number): void {
    if (!this.active) return
    this.clearWeights()

    if (!Number.isFinite(currentTime)) return
    const time = Math.max(0, currentTime)
    const event = this.document.events.find(
      (candidate) => time >= candidate.start && time < candidate.end,
    )
    if (!event || event.type === 'sil') return

    this.weights[event.type] = this.clamp(event.weight)
  }

  public getCurrentWeights(): LipSyncWeights { return { ...this.weights } }

  private clearWeights(): void {
    LIP_SYNC_VISEMES.forEach((viseme) => { this.weights[viseme] = 0 })
  }

  private clamp(value: number): number { return Math.max(0, Math.min(1, value)) }
}

export type { LipSyncDocument, LipSyncViseme, LipSyncWeights }
