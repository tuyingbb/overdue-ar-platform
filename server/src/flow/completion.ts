import { allRows, getRow } from '../db/index.js';
import { Blocker, BlockerCode, EVIDENCE_LABEL, ReasonType, StageStatus, TERMINAL_STATUSES, CaseStatus, RoleCode } from '../common/enums.js';
import type { CurrentUser } from '../auth/index.js';
import { parseISO, hoursBetween, now } from '../common/util.js';
import { readStageSpec, resolveNext, type StageSpec, statusForStage } from './engine.js';

export interface CompletionCheckResult {
  caseNo: string;
  version: number;
  stage: {
    code: string;
    name: string;
    status: string;
    dueAt: string | null;
    overdueHours: number;
    assigneeName: string | null;
  };
  canComplete: boolean;
  blockers: Blocker[];
  warnings: { code: string; message: string; required?: boolean }[];
  nextStage: { code: string | null; name: string | null; dueAtRule: string };
}

interface CaseRow {
  id: number; case_no: string; case_status: CaseStatus; is_paused: number; row_version: number;
  reason_type: string; internal_dept_id: number | null; owner_id: number | null;
}
interface StageRow {
  id: number; case_id: number; stage_code: string; seq: number; name: string; status: string;
  assignee_id: number | null; due_at: string | null; spec_snapshot: string; started_at: string | null;
}

export function completionCheck(c: CaseRow, s: StageRow, user: CurrentUser): CompletionCheckResult {
  const spec = readStageSpec(s);
  const blockers: Blocker[] = [];
  const warnings: { code: string; message: string; required?: boolean }[] = [];

  // 1. 权限：责任人或被显式授权（case:assign 视为可代为推进）
  const isAssignee = s.assignee_id === user.id;
  const canDelegate = user.perms.includes('case:assign') || user.roles.includes(RoleCode.AR_MANAGER);
  if (!isAssignee && !canDelegate) {
    blockers.push({ code: BlockerCode.STAGE_NOT_ASSIGNEE, message: '你不是当前节点责任人，无权完成', fix: '请联系节点责任人操作' });
  }

  // 2. 终态 / 暂停
  if (TERMINAL_STATUSES.has(c.case_status)) {
    blockers.push({ code: BlockerCode.CASE_TERMINAL, message: '事项已终态，不能再操作' });
  }
  if (c.is_paused) {
    blockers.push({ code: BlockerCode.CASE_PAUSED, message: '事项已暂停，请先恢复后再推进', fix: '在操作栏点击「恢复跟进」' });
  }

  // 3. 前序节点：当前节点之前、且 blockNext 的节点必须 DONE/SKIPPED
  const prev = allRows<{ seq: number; status: string; name: string; block_next: number; spec_snapshot: string }>(
    `select seq, status, name, spec_snapshot from case_stage where case_id = ? and seq < ? order by seq desc`,
    c.id, s.seq
  );
  for (const p of prev) {
    const ps = readStageSpec(p);
    if (ps.blockNext && p.status !== StageStatus.DONE && p.status !== StageStatus.SKIPPED) {
      blockers.push({ code: BlockerCode.PREV_STAGE_INCOMPLETE, message: `前序节点「${p.name}」尚未完成`, fix: `请先完成「${p.name}」` });
      break;
    }
  }

  // 4. 凭证：必传凭证全部存在（绑定到本节点）
  const boundTypes = new Set(
    allRows<{ type: string }>(`select type from evidence where stage_id = ? and bound = 1`, s.id).map((r) => r.type)
  );
  const missing: { code: string; name: string }[] = [];
  for (const ev of spec.evidence) {
    if (ev.required && !boundTypes.has(ev.code)) missing.push({ code: ev.code, name: ev.name });
  }
  if (missing.length > 0) {
    blockers.push({
      code: BlockerCode.EVIDENCE_MISSING,
      message: `还缺 ${missing.length} 项必传凭证：${missing.map((m) => m.name).join('、')}`,
      fix: '在下方操作栏点击「上传凭证（模拟）」补齐'
    });
  }

  // 5. 原因分流卡控：进入催收口径前原因必须已分类；我方单据需指定内部整改部门
  const collectionStages = new Set(['FIRST_DUNNING', 'RECONCILE', 'PAYMENT_PLAN', 'EXECUTION', 'CLOSE']);
  if (collectionStages.has(s.stage_code) && c.reason_type === ReasonType.PENDING) {
    blockers.push({ code: BlockerCode.REASON_UNCLASSIFIED, message: '原因未分类，不能进入催收节点', fix: '请在「原因核实」节点完成原因分类' });
  }
  if (collectionStages.has(s.stage_code) && c.reason_type === ReasonType.INTERNAL_DOC && !c.internal_dept_id) {
    blockers.push({ code: BlockerCode.INTERNAL_DEPT_REQUIRED, message: '我方单据类逾期必须指定内部整改部门', fix: '在「责任分流」节点选择责任部门' });
  }

  // 6. 已超时 → 延期原因必填（告警，不阻塞但提示）
  const due = parseISO(s.due_at);
  const overdueHours = due ? Math.max(0, hoursBetween(due, new Date())) : 0;
  if (overdueHours > 0) {
    warnings.push({ code: 'DELAY_REASON_REQUIRED', message: `本节点已超时 ${overdueHours} 小时，完成时需填写延期原因`, required: true });
  }
  if (missing.some((m) => m.code === 'OA_APPROVAL' || m.code === 'PAYMENT_PLAN')) {
    warnings.push({ code: 'OA_PENDING', message: '还款方案需在 OA 发起审批，平台只回写审批号' });
  }

  // 下一节点预览
  const reason = c.reason_type as ReasonType;
  const nextCode = resolveNext(spec, reason);
  let nextName: string | null = null;
  let dueAtRule = '—';
  if (nextCode) {
    const nr = getRow<{ name: string; spec_snapshot: string }>(`select name, spec_snapshot from case_stage where case_id=? and stage_code=?`, c.id, nextCode);
    if (nr) {
      nextName = nr.name;
      const ns = readStageSpec(nr);
      dueAtRule = `完成后 ${ns.slaValue} ${ns.slaUnit === 'WORKDAY' ? '个工作日' : ns.slaUnit === 'NATURAL' ? '个自然日' : '小时'}内到期（当日 18:00 起算）`;
    }
  } else {
    dueAtRule = '完成后事项进入终态';
  }

  const assigneeName = s.assignee_id
    ? getRow<{ name: string }>(`select name from app_user where id=?`, s.assignee_id)?.name || null
    : null;

  return {
    caseNo: c.case_no,
    version: c.row_version,
    stage: { code: s.stage_code, name: s.name, status: s.status, dueAt: s.due_at, overdueHours, assigneeName },
    canComplete: blockers.length === 0,
    blockers,
    warnings,
    nextStage: { code: nextCode, name: nextName, dueAtRule }
  };
}

export { EVIDENCE_LABEL, statusForStage, now };
