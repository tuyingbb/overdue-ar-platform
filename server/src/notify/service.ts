import { allRows, getRow, run, tx } from '../db/index.js';
import { jparse, now } from '../common/util.js';
import { getRow as gr } from '../db/index.js';

export interface NotificationView {
  id: number; type: string; title: string; body: string | null; channel: string;
  status: string; caseNo: string | null; createdAt: string;
}

export function deliverOutbox(batchSize = 50): { sent: number; failed: number } {
  const rows = allRows<{ id: number; aggregate_type: string; aggregate_id: string; aggregate_seq: number; event_type: string; payload: string }>(
    `select * from outbox_event where status='NEW' and next_retry_at <= datetime('now') order by id asc limit ?`, batchSize
  );
  let sent = 0, failed = 0;
  for (const ev of rows) {
    try {
      tx(() => {
        const payload = jparse<Record<string, unknown>>(ev.payload, {});
        const notifs = buildNotifications(ev.event_type, payload);
        for (const n of notifs) {
          const dedupe = `${ev.event_type}:${ev.aggregate_id}:${ev.aggregate_seq}:${n.userId}`;
          run(`insert or ignore into notification(user_id, type, title, body, channel, status, dedupe_key, case_id)
              values(?,?,?,?,?,'NEW',?,?)`,
            n.userId, n.type, n.title, n.body || null, 'INAPP', dedupe, n.caseNo || null);
        }
        run(`update outbox_event set status='SENT', attempts=attempts+1 where id=?`, ev.id);
      });
      sent++;
    } catch (e) {
      failed++;
      run(`update outbox_event set status='NEW', attempts=attempts+1, next_retry_at=datetime('now','+5 minutes'), last_error=? where id=?`,
        String(e).slice(0, 500), ev.id);
    }
  }
  return { sent, failed };
}

interface Notif { userId: number; type: string; title: string; body?: string; caseNo?: string }
function buildNotifications(eventType: string, payload: Record<string, unknown>): Notif[] {
  const caseNo = payload.caseNo as string | undefined;
  const out: Notif[] = [];
  switch (eventType) {
    case 'CASE_STATUS_CHANGED': {
      const to = payload.ownerId as number | undefined;
      const stage = payload.stage as string;
      if (to) {
        out.push({ userId: to, type: 'STAGE_ASSIGNED', title: `你有新的待办：${caseNo}`, body: `节点「${stageLabel(stage)}」已流转到你，请及时处理`, caseNo });
      }
      break;
    }
    case 'STAGE_ESCALATED': {
      const to = payload.ownerId as number | undefined;
      const sup = payload.supervisorId as number | undefined;
      const level = payload.level as number;
      if (to) out.push({ userId: to, type: 'ESCALATION', title: `${caseNo} 已升级到 L${level}`, body: '请尽快处理，否则将继续升级', caseNo });
      if (sup && sup !== to) out.push({ userId: sup, type: 'ESCALATION', title: `${caseNo} 下属节点已超时升级 L${level}`, body: '请关注并督办', caseNo });
      break;
    }
    case 'CASE_PAUSED':
      out.push({ userId: payload.actorId as number, type: 'CASE_PAUSED', title: `${caseNo} 已暂停`, caseNo });
      break;
  }
  return out;
}

function stageLabel(code?: string): string {
  const map: Record<string, string> = {
    INTAKE: '逾期入账', REASON_CHECK: '原因核实', ROUTING: '责任分流', RECTIFY: '内部整改',
    FIRST_DUNNING: '首次催收', RECONCILE: '对账确认', PAYMENT_PLAN: '还款方案', EXECUTION: '执行跟进', CLOSE: '关闭/移交'
  };
  return map[code || ''] || code || '节点';
}

export function listNotifications(userId: number, limit = 30): { list: NotificationView[]; unread: number } {
  const unread = (gr<{ n: number }>(`select count(*) as n from notification where user_id=? and status='NEW'`, userId)?.n ?? 0) as number;
  const rows = allRows<NotificationView & { case_id: number | null }>(
    `select id, type, title, body, channel, status, case_id, created_at as createdAt from notification where user_id=? order by id desc limit ?`, userId, limit
  );
  const list = rows.map((r) => {
    const caseNo = r.case_id ? gr<{ case_no: string }>(`select case_no from overdue_case where id=?`, r.case_id)?.case_no : null;
    return { ...r, caseNo } as NotificationView;
  });
  return { list, unread };
}

export function markRead(userId: number, id?: number) {
  if (id) run(`update notification set status='READ' where user_id=? and id=?`, userId, id);
  else run(`update notification set status='READ' where user_id=? and status='NEW'`, userId);
  return { ok: true };
}

export { now };
