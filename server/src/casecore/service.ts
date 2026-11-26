import { allRows, getRow, run, tx, scalar } from '../db/index.js';
import type { CurrentUser } from '../auth/index.js';
import { caseScopePredicate, canAccessCase, applyFieldMask } from '../identity/scope.js';
import { notFound, badRequest, conflict, validationError } from '../common/errors.js';
import {
  CaseStatus, StageStatus, ReasonType, REASON_LABEL, AGING_LABEL, RISK_LABEL, EVIDENCE_LABEL,
  BlockerCode
} from '../common/enums.js';
import { parseISO, hoursBetween, jstring, jparse, now } from '../common/util.js';
import { completionCheck, type CompletionCheckResult } from '../flow/completion.js';
import {
  readStageSpec, resolveNext, computeDueAt, resolveAssignee, statusForStage, instantiateCase,
  getPublishedTemplate, type CaseLite
} from '../flow/engine.js';
import { appendAudit } from '../audit/audit.js';
import { emitOutbox } from '../integration/outbox.js';
import { addWorkdays } from '../flow/calendar.js';

const STATUS_LABEL: Record<string, string> = {
  PENDING_ASSIGN: '待分派', REASON_CHECK: '原因核实', INTERNAL_RECTIFY: '内部整改',
  IN_PROGRESS: '跟进中', PLAN_PENDING: '方案待审', EXECUTING: '执行中',
  SETTLED: '已结清', WRITTEN_OFF: '已核销', LEGAL: '已移交法务'
};

function maskCents(cents: number | null, visible: boolean) {
  if (!visible) return { cents: null, wan: '****', yuan: null };
  const wan = (cents || 0) / 1_000_000;
  return { cents, wan: (wan >= 100 ? wan.toFixed(0) : wan.toFixed(1)) + '万', yuan: (cents || 0) / 100 };
}

interface ListRow {
  id: number; case_no: string; customer_name: string; contract_no: string | null; sales_order_no: string | null;
  overdue_amount_cents: number; currency: string; aging_bucket: string; overdue_days: number; reason_type: string;
  risk_level: string; case_status: string; is_paused: number; row_version: number; owner_id: number | null;
  org_id: number; org_name: string; org_path: string; owner_name: string | null;
  current_stage_code: string | null; current_stage_name: string | null; due_at: string | null; overdue_hours: number; stage_id: number | null;
}

export interface CaseListItem {
  id: number; caseNo: string; customerName: string; contractNo: string | null; salesOrderNo: string | null;
  overdueAmountCents: number | null; overdueAmountWan: string; currency: string | null; agingBucket: string; agingLabel: string;
  overdueDays: number; reasonType: string; reasonLabel: string; riskLevel: string; riskLabel: string;
  caseStatus: string; statusLabel: string; isPaused: boolean; ownerName: string | null; orgName: string;
  currentStageCode: string | null; currentStageName: string | null; overdueHours: number; stageId: number | null;
  maskedFields: string[];
}

export function listCases(params: {
  agingBucket?: string; reasonType?: string; caseStatus?: string; riskLevel?: string; orgId?: number;
  q?: string; page?: number; pageSize?: number;
}, user: CurrentUser): { list: CaseListItem[]; total: number; page: number; pageSize: number } {
  const page = Math.max(1, params.page || 1);
  const pageSize = Math.min(100, params.pageSize || 20);
  const scope = caseScopePredicate(user, 'c');
  const where: string[] = [];
  const p: unknown[] = [...scope.params];
  if (params.agingBucket) { where.push('c.aging_bucket = ?'); p.push(params.agingBucket); }
  if (params.reasonType) { where.push('c.reason_type = ?'); p.push(params.reasonType); }
  if (params.caseStatus) { where.push('c.case_status = ?'); p.push(params.caseStatus); }
  if (params.riskLevel) { where.push('c.risk_level = ?'); p.push(params.riskLevel); }
  if (params.orgId) { where.push('c.org_id IN (SELECT id FROM org_unit WHERE id = ? OR path LIKE ?)'); p.push(params.orgId, `%/${params.orgId}`); }
  if (params.q) { where.push('(c.case_no LIKE ? OR c.customer_name LIKE ?)'); p.push(`%${params.q}%`, `%${params.q}%`); }
  const whereSql = where.length ? ' AND ' + where.join(' AND ') : '';
  const total = (scalar<number>(
    `select count(*) from overdue_case c where 1=1 ${scope.sql} ${whereSql}`, ...p
  ) ?? 0) as number;
  const rows = allRows<ListRow>(
    `select c.id, c.case_no, c.customer_name, c.contract_no, c.sales_order_no,
       c.overdue_amount_cents, c.currency, c.aging_bucket, c.overdue_days,
       c.reason_type, c.risk_level, c.case_status, c.is_paused, c.row_version,
       c.owner_id, c.org_id, o.name as org_name, o.path as org_path,
       u.name as owner_name,
       cs.stage_code as current_stage_code, cs.name as current_stage_name, cs.due_at, cs.overdue_hours, cs.id as stage_id
    from overdue_case c
    join org_unit o on o.id = c.org_id
    left join app_user u on u.id = c.owner_id
    left join case_stage cs on cs.id = c.current_stage_id
    where 1=1 ${scope.sql} ${whereSql}
    order by c.overdue_amount_cents desc, c.overdue_days desc
    limit ? offset ?`,
    ...p, pageSize, (page - 1) * pageSize
  );
  const list = rows.map((r) => mapListItem(r, user));
  return { list, total, page, pageSize };
}

function mapListItem(r: ListRow, user: CurrentUser): CaseListItem {
  const m = maskCents(r.overdue_amount_cents, user.scope.amountVisible);
  const dto: CaseListItem = {
    id: r.id, caseNo: r.case_no, customerName: r.customer_name, contractNo: r.contract_no, salesOrderNo: r.sales_order_no,
    overdueAmountCents: m.cents, overdueAmountWan: m.wan, currency: user.scope.amountVisible ? r.currency : null,
    agingBucket: r.aging_bucket, agingLabel: AGING_LABEL[r.aging_bucket as keyof typeof AGING_LABEL] || r.aging_bucket,
    overdueDays: r.overdue_days, reasonType: r.reason_type, reasonLabel: REASON_LABEL[r.reason_type as ReasonType] || r.reason_type,
    riskLevel: r.risk_level, riskLabel: RISK_LABEL[r.risk_level as keyof typeof RISK_LABEL] || r.risk_level,
    caseStatus: r.case_status, statusLabel: STATUS_LABEL[r.case_status] || r.case_status, isPaused: !!r.is_paused,
    ownerName: r.owner_name, orgName: r.org_name, currentStageCode: r.current_stage_code, currentStageName: r.current_stage_name,
    overdueHours: r.overdue_hours || 0, stageId: r.stage_id, maskedFields: []
  };
  return applyFieldMask(user, dto) as CaseListItem;
}

export interface CaseDetail extends CaseListItem {
  customerId: string | null; internalDeptId: number | null; internalDeptName: string | null;
  ownerId: number | null; orgId: number; erpSyncedAt: string | null; closedAt: string | null;
  createdAt: string; updatedAt: string; version: number; currentStageId: number | null;
  stages: StageView[];
}
export interface StageView {
  id: number; code: string; seq: number; name: string; status: string;
  assigneeId: number | null; assigneeName: string | null; startedAt: string | null; dueAt: string | null;
  completedAt: string | null; overdueHours: number; escalationLevel: number; isCurrent: boolean;
  requiredEvidence: { code: string; name: string; required: boolean; provided: boolean }[];
  spec: unknown;
}

export function getCase(caseNo: string, user: CurrentUser): CaseDetail | null {
  const c = getRow<ListRow & { customer_id: string; internal_dept_id: number | null; erp_synced_at: string; closed_at: string | null; created_at: string; updated_at: string; current_stage_id: number | null; owner_id: number | null; org_id: number }>(
    `select c.*, o.name as org_name, o.path as org_path, u.name as owner_name,
            cs.stage_code as current_stage_code, cs.name as current_stage_name, cs.due_at, cs.overdue_hours, cs.id as stage_id
     from overdue_case c
     join org_unit o on o.id=c.org_id
     left join app_user u on u.id=c.owner_id
     left join case_stage cs on cs.id=c.current_stage_id
     where c.case_no = ?`, caseNo
  );
  if (!c || !canAccessCase(user, c)) return null;
  const item = mapListItem(c, user);
  const internalDeptName = c.internal_dept_id
    ? getRow<{ name: string }>(`select name from org_unit where id=?`, c.internal_dept_id)?.name || null
    : null;
  const stages = allRows<{
    id: number; stage_code: string; seq: number; name: string; status: string; assignee_id: number | null;
    started_at: string | null; due_at: string | null; completed_at: string | null; overdue_hours: number;
    escalation_level: number; spec_snapshot: string;
  }>(`select * from case_stage where case_id=? order by seq asc`, c.id);
  const boundTypes = new Set(allRows<{ type: string }>(`select type from evidence where case_id=? and bound=1`, c.id).map((r) => r.type));
  const stageViews: StageView[] = stages.map((s) => {
    const spec = readStageSpec(s);
    const assigneeName = s.assignee_id ? getRow<{ name: string }>(`select name from app_user where id=?`, s.assignee_id)?.name || null : null;
    return {
      id: s.id, code: s.stage_code, seq: s.seq, name: s.name, status: s.status,
      assigneeId: s.assignee_id, assigneeName, startedAt: s.started_at, dueAt: s.due_at,
      completedAt: s.completed_at, overdueHours: s.overdue_hours || 0, escalationLevel: s.escalation_level,
      isCurrent: s.id === c.current_stage_id,
      requiredEvidence: spec.evidence.map((e) => ({ code: e.code, name: e.name, required: e.required, provided: boundTypes.has(e.code) })),
      spec
    };
  });
  return {
    ...item,
    customerId: user.scope.customerVisible ? c.customer_id : null,
    internalDeptId: c.internal_dept_id, internalDeptName,
    ownerId: c.owner_id, orgId: c.org_id, erpSyncedAt: c.erp_synced_at, closedAt: c.closed_at,
    createdAt: c.created_at, updatedAt: c.updated_at, version: c.row_version, currentStageId: c.current_stage_id,
    stages: stageViews
  };
}

export interface TimelineItem {
  id: number; type: string; occurredAt: string; operatorName: string | null;
  title: string; detail: string;
}
export function getTimeline(caseNo: string, user: CurrentUser, limit = 60): { items: TimelineItem[] } {
  const c = getRow<{ id: number; owner_id: number; org_id: number }>(`select id, owner_id, org_id from overdue_case where case_no=?`, caseNo);
  if (!c || !canAccessCase(user, c)) return { items: [] };
  const items: TimelineItem[] = [];
  const trans = allRows<{ id: number; occurred_at: string; operator_id: number | null; event: string; from_status: string | null; to_status: string | null; stage_code: string | null; note: string | null }>(
    `select * from case_transition where case_id=? order by occurred_at desc limit ?`, c.id, limit
  );
  for (const t of trans) {
    const op = t.operator_id ? (getRow<{ name: string }>(`select name from app_user where id=?`, t.operator_id)?.name ?? null) : null;
    items.push({
      id: t.id, type: 'transition', occurredAt: t.occurred_at, operatorName: op,
      title: eventTitle(t.event, t), detail: t.note || statusNote(t)
    });
  }
  const evs = allRows<{ id: number; uploaded_at: string; uploaded_by: number | null; type: string; name: string; note: string | null }>(
    `select * from evidence where case_id=? order by uploaded_at desc limit ?`, c.id, limit
  );
  for (const e of evs) {
    const op = e.uploaded_by ? (getRow<{ name: string }>(`select name from app_user where id=?`, e.uploaded_by)?.name ?? null) : null;
    items.push({ id: e.id + 1000000, type: 'evidence', occurredAt: e.uploaded_at, operatorName: op, title: `上传凭证：${EVIDENCE_LABEL[e.type as keyof typeof EVIDENCE_LABEL] || e.type}`, detail: e.name + (e.note ? `（${e.note}）` : '') });
  }
  const comms = allRows<{ id: number; occurred_at: string; operator_id: number | null; channel: string; conclusion: string }>(
    `select * from communication_log where case_id=? order by occurred_at desc limit ?`, c.id, limit
  );
  for (const cm of comms) {
    const op = cm.operator_id ? (getRow<{ name: string }>(`select name from app_user where id=?`, cm.operator_id)?.name ?? null) : null;
    items.push({ id: cm.id + 2000000, type: 'communication', occurredAt: cm.occurred_at, operatorName: op, title: `沟通记录（${cm.channel}）`, detail: cm.conclusion });
  }
  items.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));
  return { items: items.slice(0, limit) };
}

function eventTitle(event: string, t: { stage_code: string | null; from_status: string | null; to_status: string | null }): string {
  switch (event) {
    case 'STAGE_COMPLETED': return `完成节点：${t.stage_code}`;
    case 'REASON_CLASSIFIED': return '完成原因分类';
    case 'CASE_PAUSED': return '暂停跟进';
    case 'CASE_RESUMED': return '恢复跟进';
    case 'REASSIGNED': return '责任人改派';
    case 'CASE_CREATED': return '逾期入账（ERP 同步）';
    case 'CASE_CLOSED': return '事项关闭';
    default: return event;
  }
}
function statusNote(t: { from_status: string | null; to_status: string | null }): string {
  return `${STATUS_LABEL[t.from_status || ''] || t.from_status || '—'} → ${STATUS_LABEL[t.to_status || ''] || t.to_status || '—'}`;
}

export function getCompletionCheck(caseNo: string, stageId: number, user: CurrentUser): CompletionCheckResult {
  const c = getRow<{
    id: number; case_no: string; case_status: CaseStatus; is_paused: number; row_version: number;
    reason_type: string; internal_dept_id: number | null; owner_id: number | null; org_id: number;
  }>(`select id, case_no, case_status, is_paused, row_version, reason_type, internal_dept_id, owner_id, org_id from overdue_case where case_no=?`, caseNo);
  if (!c || !canAccessCase(user, c)) throw notFound();
  const s = getRow<{ id: number; case_id: number; stage_code: string; seq: number; name: string; status: string; assignee_id: number | null; due_at: string | null; spec_snapshot: string; started_at: string | null }>(
    `select * from case_stage where id=? and case_id=?`, stageId, c.id
  );
  if (!s) throw notFound('节点不存在');
  return completionCheck(c, s, user);
}

export interface CompletePayload {
  version: number;
  evidenceIds?: number[];
  reasonType?: string;
  internalDeptId?: number;
  delayReason?: string;
  closeType?: 'SETTLE' | 'LEGAL' | 'WRITE_OFF';
  note?: string;
}

export function completeStage(caseNo: string, stageId: number, payload: CompletePayload, user: CurrentUser, idemKey: string | undefined, ip: string | undefined) {
  return tx(() => {
    if (idemKey) {
      const ex = getRow<{ response: string }>(`select response from idempotency_record where user_id=? and idem_key=?`, user.id, idemKey);
      if (ex) return JSON.parse(ex.response) as Record<string, unknown>;
    }
    const c = getRow<{
      id: number; case_no: string; case_status: CaseStatus; is_paused: number; row_version: number;
      reason_type: string; internal_dept_id: number | null; owner_id: number | null; org_id: number;
      current_stage_id: number | null; erp_ar_id: string; customer_name: string;
    }>(`select * from overdue_case where case_no=?`, caseNo);
    if (!c || !canAccessCase(user, c)) throw notFound();
    if (payload.version !== c.row_version) throw conflict();

    const s = getRow<{
      id: number; case_id: number; stage_code: string; seq: number; name: string; status: string; row_version: number;
      assignee_id: number | null; due_at: string | null; started_at: string | null; spec_snapshot: string;
    }>(`select * from case_stage where id=? and case_id=?`, stageId, c.id);
    if (!s) throw notFound('节点不存在');
    if (s.status !== StageStatus.ACTIVE) throw badRequest('该节点不在进行中');
    if (c.current_stage_id !== s.id) throw badRequest('不是当前进行中的节点');

    const check = completionCheck(c, s, user);
    if (!check.canComplete) throw validationError(check.blockers);
    if (check.stage.overdueHours > 0 && !payload.delayReason) {
      throw validationError([{ code: BlockerCode.DELAY_REASON_REQUIRED, message: '本节点已超时，完成时必须填写延期原因' }]);
    }

    // 绑定凭证
    if (payload.evidenceIds && payload.evidenceIds.length) {
      const placeholders = payload.evidenceIds.map(() => '?').join(',');
      const owned = allRows<{ id: number }>(`select id from evidence where case_id=? and id in (${placeholders})`, c.id, ...payload.evidenceIds);
      if (owned.length !== payload.evidenceIds.length) throw badRequest('存在不属于本事项的凭证');
      run(`update evidence set stage_id=?, bound=1 where case_id=? and id in (${placeholders}) and bound=0`, s.id, c.id, ...payload.evidenceIds);
    }

    // 节点置完成（行版本乐观锁）
    const upd = run(`update case_stage set status=?, completed_at=datetime('now'), row_version=row_version+1 where id=? and status=? and row_version=?`,
      StageStatus.DONE, s.id, StageStatus.ACTIVE, s.row_version);
    if (upd.changes === 0) throw conflict();

    const spec = readStageSpec(s);
    const reason = (payload.reasonType || c.reason_type) as ReasonType;
    const nextCode = resolveNext(spec, reason);
    let newStatus: CaseStatus = c.case_status;
    let newOwner = c.owner_id;
    let newCurrentStageId: number | null = c.current_stage_id;

    const orgPathRow = getRow<{ path: string }>(`select path from org_unit where id=?`, c.org_id);
    const cLite: CaseLite = {
      id: c.id, owner_id: c.owner_id, org_id: c.org_id, org_path: orgPathRow?.path || '',
      internal_dept_id: payload.internalDeptId ?? c.internal_dept_id, reason_type: reason
    };

    if (nextCode) {
      const ns = getRow<{ id: number; spec_snapshot: string }>(`select * from case_stage where case_id=? and stage_code=?`, c.id, nextCode);
      if (ns) {
        const nsSpec = readStageSpec(ns);
        const start = new Date();
        const due = computeDueAt(nsSpec, start);
        const ass = resolveAssignee(nsSpec, cLite);
        run(`update case_stage set status=?, started_at=?, due_at=?, assignee_id=?, assignee_dept_id=?, overdue_hours=0, overdue_workdays=0, escalation_level=0, row_version=row_version+1 where id=? and status=?`,
          StageStatus.ACTIVE, start.toISOString(), due.toISOString(), ass.userId, ass.deptId, ns.id, StageStatus.PENDING);
        newStatus = statusForStage(nextCode, false);
        newOwner = ass.userId ?? c.owner_id;
        newCurrentStageId = ns.id;
      }
    } else {
      // 终态
      const closeType = payload.closeType || 'SETTLE';
      newStatus = closeType === 'LEGAL' ? CaseStatus.LEGAL : closeType === 'WRITE_OFF' ? CaseStatus.WRITTEN_OFF : CaseStatus.SETTLED;
      run(`update case_stage set status=?, completed_at=datetime('now') where case_id=? and status in (?,?)`, StageStatus.CANCELLED, c.id, StageStatus.PENDING, StageStatus.ACTIVE);
      run(`update overdue_case set closed_at=datetime('now') where id=?`, c.id);
      newCurrentStageId = null;
      run(`insert into case_transition(case_id,event,from_status,to_status,stage_code,operator_id,note) values(?,?,?,?,?,?,?)`,
        c.id, 'CASE_CLOSED', c.case_status, newStatus, s.stage_code, user.id, payload.note || '');
    }

    // 原因分类写入（REASON_CHECK / ROUTING 完成时）
    let reasonSql = '';
    const reasonParams: unknown[] = [];
    if (payload.reasonType && payload.reasonType !== c.reason_type) {
      reasonSql = `, reason_type=?, internal_dept_id=?`;
      reasonParams.push(payload.reasonType, payload.internalDeptId ?? null);
      run(`insert into case_transition(case_id,event,from_status,to_status,stage_code,operator_id,note) values(?,?,?,?,?,?,?)`,
        c.id, 'REASON_CLASSIFIED', c.reason_type, payload.reasonType, s.stage_code, user.id,
        `原因：${REASON_LABEL[payload.reasonType as ReasonType] || payload.reasonType}`);
    }

    const before = { status: c.case_status, currentStageId: c.current_stage_id, owner: c.owner_id, reason: c.reason_type };
    run(`update overdue_case set current_stage_id=?, case_status=?, owner_id=?, row_version=row_version+1, updated_at=datetime('now') ${reasonSql} where id=? and row_version=?`,
      newCurrentStageId, newStatus, newOwner, ...reasonParams, c.id, c.row_version);

    run(`insert into case_transition(case_id,event,from_status,to_status,stage_code,operator_id,note) values(?,?,?,?,?,?,?)`,
      c.id, 'STAGE_COMPLETED', c.case_status, newStatus, s.stage_code, user.id, payload.note || '');

    appendAudit({
      actor: user, action: 'STAGE_COMPLETED', objectType: 'case', objectId: c.case_no, ip,
      before, after: { status: newStatus, currentStageId: newCurrentStageId, owner: newOwner, reason, delayReason: payload.delayReason }
    });
    emitOutbox('case', c.case_no, 'CASE_STATUS_CHANGED', {
      caseNo: c.case_no, from: c.case_status, to: newStatus, stage: s.stage_code, nextStage: nextCode, ownerId: newOwner, actorId: user.id
    });

    const result = { ok: true, caseNo, status: newStatus, statusLabel: STATUS_LABEL[newStatus], currentStageId: newCurrentStageId, version: c.row_version + 1 };
    if (idemKey) {
      run(`insert or replace into idempotency_record(user_id, idem_key, body_hash, response) values(?,?,?,?)`,
        user.id, idemKey, '', jstring(result));
    }
    return result;
  });
}

export function pauseCase(caseNo: string, reason: string, user: CurrentUser) {
  return tx(() => {
    const c = getRow<{ id: number; case_no: string; is_paused: number; case_status: CaseStatus; owner_id: number; org_id: number; row_version: number }>(`select * from overdue_case where case_no=?`, caseNo);
    if (!c || !canAccessCase(user, c)) throw notFound();
    if (c.is_paused) throw badRequest('事项已暂停');
    run(`update overdue_case set is_paused=1, paused_at=datetime('now'), row_version=row_version+1, updated_at=datetime('now') where id=?`, c.id);
    run(`insert into case_pause(case_id,paused_at,reason,operator_id) values(?,datetime('now'),?,?)`, c.id, reason, user.id);
    run(`insert into case_transition(case_id,event,from_status,to_status,operator_id,note) values(?,?,?,?,?,?)`, c.id, 'CASE_PAUSED', c.case_status, c.case_status, user.id, reason);
    appendAudit({ actor: user, action: 'CASE_PAUSED', objectType: 'case', objectId: c.case_no, after: { reason } });
    emitOutbox('case', c.case_no, 'CASE_PAUSED', { caseNo: c.case_no, reason, actorId: user.id });
    return { ok: true };
  });
}

export function resumeCase(caseNo: string, user: CurrentUser) {
  return tx(() => {
    const c = getRow<{ id: number; case_no: string; is_paused: number; case_status: CaseStatus; paused_at: string; owner_id: number; org_id: number }>(`select * from overdue_case where case_no=?`, caseNo);
    if (!c || !canAccessCase(user, c)) throw notFound();
    if (!c.is_paused) throw badRequest('事项未暂停');
    const pausedAt = parseISO(c.paused_at);
    const pausedMin = pausedAt ? Math.max(0, Math.floor((Date.now() - pausedAt.getTime()) / 60000)) : 0;
    run(`update overdue_case set is_paused=0, paused_at=null, pause_minutes=pause_minutes+?, row_version=row_version+1, updated_at=datetime('now') where id=?`, pausedMin, c.id);
    run(`update case_pause set resumed_at=datetime('now') where case_id=? and resumed_at is null`, c.id);
    run(`insert into case_transition(case_id,event,from_status,to_status,operator_id,note) values(?,?,?,?,?,?)`, c.id, 'CASE_RESUMED', c.case_status, c.case_status, user.id, '');
    appendAudit({ actor: user, action: 'CASE_RESUMED', objectType: 'case', objectId: c.case_no });
    return { ok: true };
  });
}

export function reassignCase(caseNo: string, newOwnerId: number, reason: string, user: CurrentUser) {
  return tx(() => {
    const c = getRow<{ id: number; case_no: string; owner_id: number | null; org_id: number; row_version: number; case_status: CaseStatus }>(`select * from overdue_case where case_no=?`, caseNo);
    if (!c || !canAccessCase(user, c)) throw notFound();
    if (!user.perms.includes('case:assign')) throw badRequest('无改派权限');
    const nu = getRow<{ id: number; name: string }>(`select id, name from app_user where id=? and status='ACTIVE'`, newOwnerId);
    if (!nu) throw badRequest('目标用户不存在');
    const before = { owner: c.owner_id };
    run(`update overdue_case set owner_id=?, row_version=row_version+1, updated_at=datetime('now') where id=?`, newOwnerId, c.id);
    // 当前进行中节点若责任角色是 SALES，同步改派
    run(`update case_stage set assignee_id=? where case_id=? and status='ACTIVE' and exists (select 1 from case_stage cs where cs.id=case_stage.id)`, newOwnerId, c.id);
    run(`insert into case_transition(case_id,event,from_status,to_status,operator_id,note) values(?,?,?,?,?,?)`, c.id, 'REASSIGNED', c.case_status, c.case_status, user.id, `改派给 ${nu.name}：${reason}`);
    appendAudit({ actor: user, action: 'REASSIGNED', objectType: 'case', objectId: c.case_no, before, after: { owner: newOwnerId }, result: 'SUCCESS' });
    return { ok: true, ownerName: nu.name };
  });
}

export function uploadEvidence(caseNo: string, payload: { stageId?: number; type: string; name: string; note?: string }, user: CurrentUser) {
  return tx(() => {
    const c = getRow<{ id: number; case_no: string; owner_id: number; org_id: number; current_stage_id: number | null }>(`select * from overdue_case where case_no=?`, caseNo);
    if (!c || !canAccessCase(user, c)) throw notFound();
    const targetStage = payload.stageId ?? c.current_stage_id;
    let bound = 0;
    if (targetStage) {
      const ok = getRow<{ n: number }>(`select count(*) as n from case_stage where id=? and case_id=?`, targetStage, c.id);
      if (!ok || ok.n === 0) throw badRequest('节点不属于本事项');
      bound = 1;
    }
    const r = run(`insert into evidence(case_id, stage_id, type, name, note, uploaded_by, bound) values(?,?,?,?,?,?,?)`,
      c.id, targetStage ?? null, payload.type, payload.name, payload.note || null, user.id, bound);
    const id = Number(r.lastInsertRowid);
    appendAudit({ actor: user, action: 'EVIDENCE_UPLOAD', objectType: 'case', objectId: c.case_no, after: { evidenceId: id, type: payload.type, name: payload.name } });
    return { ok: true, id, bound: !!bound };
  });
}

export function addCommunication(caseNo: string, payload: { channel: string; contact?: string; conclusion: string; nextCommitmentAt?: string }, user: CurrentUser) {
  return tx(() => {
    const c = getRow<{ id: number; owner_id: number; org_id: number; case_no: string }>(`select id, owner_id, org_id, case_no from overdue_case where case_no=?`, caseNo);
    if (!c || !canAccessCase(user, c)) throw notFound();
    run(`insert into communication_log(case_id, channel, contact, conclusion, next_commitment_at, operator_id) values(?,?,?,?,?,?)`,
      c.id, payload.channel, payload.contact || null, payload.conclusion, payload.nextCommitmentAt || null, user.id);
    appendAudit({ actor: user, action: 'COMMUNICATION_LOG', objectType: 'case', objectId: c.case_no, after: payload });
    return { ok: true };
  });
}

export function listEvidence(caseNo: string, user: CurrentUser) {
  const c = getRow<{ id: number; owner_id: number; org_id: number }>(`select id, owner_id, org_id from overdue_case where case_no=?`, caseNo);
  if (!c || !canAccessCase(user, c)) return { list: [] };
  const rows = allRows<{ id: number; type: string; name: string; note: string | null; uploaded_at: string; uploaded_by: number | null; bound: number; stage_id: number | null }>(
    `select * from evidence where case_id=? order by uploaded_at desc`, c.id
  );
  return {
    list: rows.map((r) => ({
      id: r.id, type: r.type, typeLabel: EVIDENCE_LABEL[r.type as keyof typeof EVIDENCE_LABEL] || r.type,
      name: r.name, note: r.note, uploadedAt: r.uploaded_at, bound: !!r.bound, stageId: r.stage_id,
      uploadedBy: r.uploaded_by ? getRow<{ name: string }>(`select name from app_user where id=?`, r.uploaded_by)?.name || null : null
    }))
  };
}

/** ERP 导入：创建新事项并实例化流程（返回 case_no） */
export function createCaseFromErp(row: {
  erpArId: string; customerId: string; customerName: string; contractNo?: string; salesOrderNo?: string;
  overdueAmountYuan: number; overdueDays: number; agingBucket: string; orgId: number; ownerId?: number; riskLevel?: string;
}, actorId: number | null) {
  return tx(() => {
    const tpl = getPublishedTemplate();
    if (!tpl) throw badRequest('没有已发布的流程模板');
    const seq = (scalar<number>(`select count(*)+1 from overdue_case`) ?? 1) as number;
    const d = new Date();
    const caseNo = `OD-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}-${String(seq).padStart(4, '0')}`;
    const cents = Math.round(row.overdueAmountYuan * 100);
    const r = run(`insert into overdue_case(case_no, erp_ar_id, customer_id, customer_name, contract_no, sales_order_no, overdue_amount_cents, aging_bucket, overdue_days, reason_type, risk_level, owner_id, org_id, case_status, template_version_id, erp_synced_at)
       values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`,
      caseNo, row.erpArId, row.customerId, row.customerName, row.contractNo || null, row.salesOrderNo || null, cents,
      row.agingBucket, row.overdueDays, ReasonType.PENDING, row.riskLevel || 'MEDIUM', row.ownerId || null, row.orgId,
      CaseStatus.PENDING_ASSIGN, tpl.id);
    const caseId = Number(r.lastInsertRowid);
    instantiateCase(caseId, tpl.id);
    // 激活第一个节点 INTAKE（系统入账，自动完成并推进到 REASON_CHECK）
    const first = getRow<{ id: number; stage_code: string; spec_snapshot: string }>(`select * from case_stage where case_id=? order by seq asc limit 1`, caseId);
    if (first) {
      const spec = readStageSpec(first);
      const start = new Date();
      const due = computeDueAt(spec, start);
      run(`update case_stage set status='ACTIVE', started_at=?, due_at=?, assignee_id=? where id=?`, start.toISOString(), due.toISOString(), actorId, first.id);
      run(`update overdue_case set current_stage_id=? where id=?`, first.id, caseId);
    }
    run(`insert into case_transition(case_id,event,from_status,to_status,operator_id,note) values(?,?,?,?,?,?)`, caseId, 'CASE_CREATED', null, CaseStatus.PENDING_ASSIGN, actorId, 'ERP 同步入账');
    appendAudit({ actor: actorId ? { id: actorId } as CurrentUser : null, action: 'CASE_CREATED', objectType: 'case', objectId: caseNo, after: { erpArId: row.erpArId } });
    return { caseId, caseNo };
  });
}

export { now, addWorkdays, jparse };
