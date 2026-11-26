import { run, scalar } from '../db/index.js';
import { jstring } from '../common/util.js';

/** 追加一条出站事件（事务内调用，与状态变更同库同事务） */
export function emitOutbox(
  aggregateType: string,
  aggregateId: string | number,
  eventType: string,
  payload: Record<string, unknown>
): void {
  const seq = (scalar<number>(
    `select coalesce(max(aggregate_seq),0)+1 from outbox_event where aggregate_type=? and aggregate_id=?`,
    aggregateType, String(aggregateId)
  ) ?? 1) as number;
  run(
    `insert into outbox_event(aggregate_type, aggregate_id, aggregate_seq, event_type, payload, status, next_retry_at)
     values(?,?,?,?,?,'NEW',datetime('now'))`,
    aggregateType, String(aggregateId), seq, eventType, jstring(payload)
  );
}
