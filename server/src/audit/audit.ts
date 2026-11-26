import { run, allRows } from '../db/index.js';
import { jstring } from '../common/util.js';
import type { CurrentUser } from '../auth/index.js';

export interface AuditEntry {
  id: number;
  occurredAt: string;
  actorId: number | null;
  actorName: string | null;
  action: string;
  objectType: string;
  objectId: string;
  before: unknown;
  after: unknown;
  result: string;
}

export function appendAudit(opts: {
  actor: CurrentUser | null;
  action: string;
  objectType: string;
  objectId: string | number;
  before?: unknown;
  after?: unknown;
  result?: string;
  ip?: string;
}): void {
  run(
    `insert into audit_log(occurred_at, actor_id, actor_ip, action, object_type, object_id, before_json, after_json, result)
     values(datetime('now'),?,?,?,?,?,?,?,?)`,
    opts.actor?.id ?? null,
    opts.ip ?? null,
    opts.action,
    opts.objectType,
    String(opts.objectId),
    opts.before !== undefined ? jstring(opts.before) : null,
    opts.after !== undefined ? jstring(opts.after) : null,
    opts.result ?? 'SUCCESS'
  );
}

export function queryAudit(objectType: string, objectId: string | number, limit = 100): AuditEntry[] {
  return allRows<AuditEntry>(
    `select a.id, a.occurred_at as occurredAt, a.actor_id as actorId, u.name as actorName,
            a.action, a.object_type as objectType, a.object_id as objectId,
            a.before_json as before, a.after_json as after, a.result
     from audit_log a left join app_user u on u.id = a.actor_id
     where a.object_type = ? and a.object_id = ?
     order by a.id desc limit ?`,
    objectType, String(objectId), limit
  );
}
