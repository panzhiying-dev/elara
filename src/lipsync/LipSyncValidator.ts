import {
  LIP_SYNC_VISEMES,
  type LipSyncDocument,
  type LipSyncEvent,
  type LipSyncEventType,
} from './LipSyncTypes'

/** 校验未知 JSON 是否符合后端 LipSync 文档协议。 */
export function isLipSyncDocument(value: unknown): value is LipSyncDocument {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  if (
    record.version !== 1 ||
    !isFiniteNumber(record.duration) ||
    record.duration < 0 ||
    !Array.isArray(record.events)
  ) return false
  return record.events.every(isLipSyncEvent)
}

/** 校验单个 LipSync 事件的时间、类型和权重字段。 */
export function isLipSyncEvent(value: unknown): value is LipSyncEvent {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    isFiniteNumber(record.start) &&
    isFiniteNumber(record.end) &&
    record.end >= record.start &&
    isLipSyncEventType(record.type) &&
    isFiniteNumber(record.weight)
  )
}

/** 校验事件类型是否为后端定义的六种音素之一。 */
export function isLipSyncEventType(value: unknown): value is LipSyncEventType {
  return (
    value === 'sil' ||
    (typeof value === 'string' && LIP_SYNC_VISEMES.some((viseme) => viseme === value))
  )
}

/** 只接受有限数值，避免无效时间或权重进入运行时。 */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
