export type LipSyncViseme = 'aa' | 'ih' | 'ou' | 'ee' | 'oh'

export type LipSyncEventType = LipSyncViseme | 'sil'

export interface LipSyncEvent {
  start: number
  end: number
  type: LipSyncEventType
  weight: number
}

export interface LipSyncDocument {
  version: 1
  duration: number
  events: LipSyncEvent[]
}

export type LipSyncWeights = Record<LipSyncViseme, number>

export const LIP_SYNC_VISEMES: readonly LipSyncViseme[] = [
  'aa',
  'ih',
  'ou',
  'ee',
  'oh',
]
