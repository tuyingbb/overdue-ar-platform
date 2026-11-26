import { allRows, getRow } from '../db/index.js';
import type { CurrentUser } from '../auth/index.js';
import { caseScopePredicate, canAccessCase } from '../identity/scope.js';
import { REASON_LABEL, STATUS_LABEL } from '../common/enums.js';
import { shDate } from '../flow/calendar.js';
import { parseISO, hoursBetween } from '../common/util.js';
import { completionCheck } from '../flow/completion.js';

export interface TaskItem {
  caseNo: string; customerName: string; amountWan: string; overdueDays: number;
  reasonType: string; reasonLabel: string; stageId: number; stageCode: string; stageName: string;
  dueAt: string | null; overdueHours: number; caseStatus: string; statusLabel: string; riskLevel: string;
  missing: string[]; blockers: string[]; group: string;
}

function groupFor(s: { due_at: string | null; overdue_hours: number; escalation_level: number; stage_code: string }): string {
  if (s.overdue_hours > 0) return s.escalation_level >= 2 ? '已升级' : '已超时';
  if (['ROUTING', 'PAYMENT_PLAN'].includes(s.stage_code)) return '待审批';
  const due = parseISO(s.due_at);
  if (due) {
    const today = shDate(new Date());
    const dueDay = shDate(due);
    if (dueDay === today) return '今日到期';
    const diffDays = Math.ceil((due.getTime() - Date.now()) / 86400000);
    if (diffDays <= 7) return '本周到期';
  }
  return '进行中';
}

export function myTasks(user: CurrentUser): { groups: Record<string, TaskItem[]>; counts: Record<string, number> } {
  const rows = allRows<{
    case_id: number; case_no: string; customer_name: string; overdue_amount_cents: number; overdue_days: number;
    reason_type: string; risk_level: string; case_status: string; stage_id: number; stage_code: string; stage_name: string;
    due_at: string | null; overdue_hours: number; escalation_level: number; assignee_id: number;
  }>(`select c.id as case_id, c.case_no, c.customer_name, c.overdue_amount_cents, c.overdue_days, c.reason_type,
            c.risk_level, c.case_status, s.id as stage_id, s.stage_code, s.name as stage_name,
            s.due_at, s.overdue_hours, s.escalation_level, s.assignee_id
     from case_stage s join overdue_case c on c.id = s.case_id
     where s.assignee_id = ? and s.status = 'ACTIVE'
     order by s.overdue_hours desc, s.due_at asc`, user.id);
  const groups: Record<string, TaskItem[]> = {};
  const counts: Record<string, number> = {};
  for (const r of rows) {
    if (!canAccessCase(user, { id: r.case_id, owner_id: r.assignee_id, org_id: 0 }) && user.scope.type === 'NONE') continue;
    const group = groupFor(r);
    const amountVisible = user.scope.amountVisible;
    const wan = amountVisible ? ((r.overdue_amount_cents || 0) / 1_000_000).toFixed(1) + '万' : '****';
    // 缺什么：跑一次完成校验
    let missing: string[] = [];
    let blockers: string[] = [];
    try {
      const c = getRow<{ id: number; case_no: string; case_status: any; is_paused: number; row_version: number; reason_type: string; internal_dept_id: number | null; owner_id: number | null; org_id: number }>(
        `select id, case_no, case_status, is_paused, row_version, reason_type, internal_dept_id, owner_id, org_id from overdue_case where id=?`, r.case_id
      );
      const s = getRow<any>(`select * from case_stage where id=?`, r.stage_id);
      if (c && s) {
        const chk = completionCheck(c, s, user);
        missing = chk.blockers.filter((b) => b.code === 'EVIDENCE_MISSING').map((b) => b.message);
        blockers = chk.blockers.map((b) => b.message);
      }
    } catch { /* ignore */ }
    const item: TaskItem = {
      caseNo: r.case_no, customerName: user.scope.customerVisible ? r.customer_name : '无权查看',
      amountWan: wan, overdueDays: r.overdue_days, reasonType: r.reason_type,
      reasonLabel: REASON_LABEL[r.reason_type as keyof typeof REASON_LABEL] || r.reason_type,
      stageId: r.stage_id, stageCode: r.stage_code, stageName: r.stage_name, dueAt: r.due_at,
      overdueHours: r.overdue_hours || 0, caseStatus: r.case_status,
      statusLabel: STATUS_LABEL[r.case_status] || r.case_status, riskLevel: r.risk_level,
      missing, blockers, group
    };
    groups[group] = groups[group] || [];
    groups[group].push(item);
    counts[group] = (counts[group] || 0) + 1;
  }
  // 固定顺序
  const order = ['已超时', '今日到期', '本周到期', '待审批', '已升级', '进行中'];
  const sorted: Record<string, TaskItem[]> = {};
  for (const g of order) if (groups[g]) sorted[g] = groups[g];
  for (const g of Object.keys(groups)) if (!sorted[g]) sorted[g] = groups[g];
  return { groups: sorted, counts };
}

export function escalationPool(user: CurrentUser): { list: TaskItem[] } {
  const canReadPool = user.perms.includes('escalation:read');
  const scope = caseScopePredicate(user, 'c');
  const extraWhere = canReadPool ? scope.sql : ' AND s.assignee_id = ?';
  const params = canReadPool ? scope.params : [user.id];
  const rows = allRows<{
    case_id: number; case_no: string; customer_name: string; overdue_amount_cents: number; overdue_days: number;
    reason_type: string; risk_level: string; case_status: string; stage_id: number; stage_code: string; stage_name: string;
    due_at: string | null; overdue_hours: number; escalation_level: number; assignee_id: number; owner_name: string | null;
  }>(`select c.id as case_id, c.case_no, c.customer_name, c.overdue_amount_cents, c.overdue_days, c.reason_type,
            c.risk_level, c.case_status, s.id as stage_id, s.stage_code, s.name as stage_name,
            s.due_at, s.overdue_hours, s.escalation_level, s.assignee_id, u.name as owner_name
     from case_stage s join overdue_case c on c.id = s.case_id
     left join app_user u on u.id = c.owner_id
     where s.status='ACTIVE' and s.escalation_level >= 2 ${extraWhere}
     order by s.overdue_hours desc`, ...params);
  return {
    list: rows.map((r) => ({
      caseNo: r.case_no, customerName: user.scope.customerVisible ? r.customer_name : '无权查看',
      amountWan: user.scope.amountVisible ? ((r.overdue_amount_cents || 0) / 1_000_000).toFixed(1) + '万' : '****',
      overdueDays: r.overdue_days, reasonType: r.reason_type,
      reasonLabel: REASON_LABEL[r.reason_type as keyof typeof REASON_LABEL] || r.reason_type,
      stageId: r.stage_id, stageCode: r.stage_code, stageName: r.stage_name, dueAt: r.due_at,
      overdueHours: r.overdue_hours || 0, caseStatus: r.case_status,
      statusLabel: STATUS_LABEL[r.case_status] || r.case_status, riskLevel: r.risk_level,
      missing: [], blockers: [], group: '升级池', ownerName: r.owner_name
    } as TaskItem & { ownerName: string | null }))
  };
}

export function doneTasks(user: CurrentUser, limit = 20): { list: TaskItem[] } {
  const rows = allRows<{
    case_no: string; customer_name: string; overdue_amount_cents: number; overdue_days: number; reason_type: string;
    risk_level: string; case_status: string; stage_name: string; stage_code: string; completed_at: string;
  }>(`select c.case_no, c.customer_name, c.overdue_amount_cents, c.overdue_days, c.reason_type, c.risk_level,
            c.case_status, s.name as stage_name, s.stage_code, s.completed_at
     from case_stage s join overdue_case c on c.id = s.case_id
     where s.assignee_id = ? and s.status='DONE'
     order by s.completed_at desc limit ?`, user.id, limit);
  return {
    list: rows.map((r) => ({
      caseNo: r.case_no, customerName: user.scope.customerVisible ? r.customer_name : '无权查看',
      amountWan: user.scope.amountVisible ? ((r.overdue_amount_cents || 0) / 1_000_000).toFixed(1) + '万' : '****',
      overdueDays: r.overdue_days, reasonType: r.reason_type,
      reasonLabel: REASON_LABEL[r.reason_type as keyof typeof REASON_LABEL] || r.reason_type,
      stageId: 0, stageCode: r.stage_code, stageName: r.stage_name, dueAt: r.completed_at,
      overdueHours: 0, caseStatus: r.case_status, statusLabel: STATUS_LABEL[r.case_status] || r.case_status,
      riskLevel: r.risk_level, missing: [], blockers: [], group: '已办'
    }))
  };
}

export { hoursBetween };
