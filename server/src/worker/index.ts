import { allRows, getRow, run, tx } from '../db/index.js';
import { readStageSpec, findUserByRoleInOrg, type StageSpec } from '../flow/engine.js';
import { RoleCode } from '../common/enums.js';
import { parseISO, hoursBetween } from '../common/util.js';
import { workdaysBetween } from '../flow/calendar.js';
import { emitOutbox } from '../integration/outbox.js';
import { deliverOutbox } from '../notify/service.js';

export function scanTimeouts(): { updated: number; escalated: number } {
  const rows = allRows<{
    id: number; case_id: number; stage_code: string; due_at: string; overdue_hours: number; escalation_level: number; spec_snapshot: string; assignee_id: number | null;
  }>(`select * from case_stage where status='ACTIVE' and due_at is not null`);
  let updated = 0, escalated = 0;
  for (const s of rows) {
    const due = parseISO(s.due_at);
    if (!due) continue;
    const oh = Math.max(0, hoursBetween(due, new Date()));
    const wd = workdaysBetween(due, new Date());
    if (oh !== s.overdue_hours) {
      run(`update case_stage set overdue_hours=?, overdue_workdays=? where id=?`, oh, wd, s.id);
      updated++;
    }
    // 升级判定
    const spec = readStageSpec(s);
    const sorted = [...spec.escalation].sort((a, b) => a.level - b.level);
    for (const e of sorted) {
      if (wd >= e.thresholdWorkdays && s.escalation_level < e.level) {
        const ins = run(`insert or ignore into escalation_event(stage_id, case_id, level, triggered_at) values(?,?,?,datetime('now'))`, s.id, s.case_id, e.level);
        if (ins.changes > 0) {
          run(`update case_stage set escalation_level=? where id=?`, e.level, s.id);
          const c = getRow<{ org_id: number; case_no: string; owner_id: number | null }>(`select org_id, case_no, owner_id from overdue_case where id=?`, s.case_id);
          const orgPath = c ? (getRow<{ path: string }>(`select path from org_unit where id=?`, c.org_id)?.path ?? null) : null;
          const sup = findUserByRoleInOrg(RoleCode.DEPT_SUPERVISOR, orgPath);
          if (c) {
            emitOutbox('case', c.case_no, 'STAGE_ESCALATED', {
              caseNo: c.case_no, stage: s.stage_code, level: e.level, overdueWorkdays: wd,
              ownerId: s.assignee_id, supervisorId: sup
            });
          }
          escalated++;
        }
        break; // 一次扫描只升一级
      }
    }
  }
  return { updated, escalated };
}

export function runWorkerCycle(): { timeout: { updated: number; escalated: number }; outbox: { sent: number; failed: number } } {
  const timeout = scanTimeouts();
  const outbox = deliverOutbox();
  return { timeout, outbox };
}

let timer: NodeJS.Timeout | null = null;
export function startWorker(intervalMs = 30000) {
  if (timer) return;
  timer = setInterval(() => {
    try { runWorkerCycle(); } catch (e) { console.error('[worker]', e); }
  }, intervalMs);
  // 启动先跑一次
  setTimeout(() => { try { runWorkerCycle(); } catch (e) { console.error('[worker]', e); } }, 2000);
}
export function stopWorker() { if (timer) { clearInterval(timer); timer = null; } }

export { tx };
