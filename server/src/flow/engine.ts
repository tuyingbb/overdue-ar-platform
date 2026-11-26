import { allRows, getRow, run } from '../db/index.js';
import { RoleCode, ReasonType, SlaUnit, EvidenceType, StageStatus, CaseStatus } from '../common/enums.js';
import { jparse, now, jstring } from '../common/util.js';
import { addWorkdays, addNaturalDays, addHours } from './calendar.js';

export interface StageEvidenceSpec {
  code: EvidenceType;
  name: string;
  required: boolean;
}
export interface StageEscalationSpec {
  level: number;
  thresholdWorkdays: number;
  target: string; // ASSIGNEE | ASSIGNEE_SUPERVISOR | ESCALATION_POOL | LEGAL
}
export interface StageNextSpec {
  default?: string;
  routing?: Partial<Record<ReasonType, string>>;
}
export interface StageSpec {
  code: string;
  seq: number;
  name: string;
  ownerRole: RoleCode;
  slaValue: number;
  slaUnit: SlaUnit;
  evidence: StageEvidenceSpec[];
  escalation: StageEscalationSpec[];
  next: StageNextSpec;
  blockNext: boolean;
  isTerminal: boolean;
}

export function parseStageSpec(row: {
  code: string; seq: number; name: string; owner_role: string; sla_value: number; sla_unit: string;
  evidence_json: string; escalation_json: string; next_json: string; block_next: number; is_terminal: number;
}): StageSpec {
  return {
    code: row.code,
    seq: row.seq,
    name: row.name,
    ownerRole: row.owner_role as RoleCode,
    slaValue: row.sla_value,
    slaUnit: row.sla_unit as SlaUnit,
    evidence: jparse<StageEvidenceSpec[]>(row.evidence_json, []),
    escalation: jparse<StageEscalationSpec[]>(row.escalation_json, []),
    next: jparse<StageNextSpec>(row.next_json, {}),
    blockNext: !!row.block_next,
    isTerminal: !!row.is_terminal
  };
}

export interface TemplateVersion {
  id: number;
  code: string;
  name: string;
  version: number;
  status: string;
}

export function getPublishedTemplate(code = 'TPL-AR-STD'): TemplateVersion | null {
  return getRow<TemplateVersion>(
    `select id, code, name, version, status from flow_template where code = ? and status = 'PUBLISHED' order by version desc limit 1`,
    code
  );
}

export function getTemplate(id: number): TemplateVersion | null {
  return getRow<TemplateVersion>(`select id, code, name, version, status from flow_template where id = ?`, id);
}

export function getStageDefs(templateId: number): StageSpec[] {
  const rows = allRows<{
    code: string; seq: number; name: string; owner_role: string; sla_value: number; sla_unit: string;
    evidence_json: string; escalation_json: string; next_json: string; block_next: number; is_terminal: number;
  }>(`select * from stage_def where template_id = ? order by seq asc`, templateId);
  return rows.map(parseStageSpec);
}

/** 根据已发布模板为新事项实例化全部节点（PENDING） */
export function instantiateCase(caseId: number, templateId: number): void {
  const stages = getStageDefs(templateId);
  for (const s of stages) {
    run(
      `insert into case_stage(case_id, stage_code, seq, name, status, spec_snapshot) values(?,?,?,?,?,?)`,
      caseId, s.code, s.seq, s.name, StageStatus.PENDING, jstring(s)
    );
  }
}

export function computeDueAt(spec: StageSpec, start: Date): Date {
  switch (spec.slaUnit) {
    case SlaUnit.WORKDAY:
      return addWorkdays(start, spec.slaValue);
    case SlaUnit.NATURAL:
      return addNaturalDays(start, spec.slaValue);
    case SlaUnit.HOUR:
    default:
      return addHours(start, spec.slaValue);
  }
}

/** 路由解析：依据事项原因类型选择下一节点 */
export function resolveNext(spec: StageSpec, reasonType: ReasonType): string | null {
  if (spec.next.routing && spec.next.routing[reasonType]) return spec.next.routing[reasonType]!;
  return spec.next.default || null;
}

export function readStageSpec(stageRow: { spec_snapshot: string }): StageSpec {
  return jparse<StageSpec>(stageRow.spec_snapshot, {} as StageSpec);
}

/** 节点 → 事项状态 映射 */
export function statusForStage(stageCode: string | null, isTerminal: boolean): CaseStatus {
  if (isTerminal || !stageCode) return CaseStatus.SETTLED;
  switch (stageCode) {
    case 'INTAKE': return CaseStatus.PENDING_ASSIGN;
    case 'REASON_CHECK':
    case 'ROUTING': return CaseStatus.REASON_CHECK;
    case 'RECTIFY': return CaseStatus.INTERNAL_RECTIFY;
    case 'FIRST_DUNNING':
    case 'RECONCILE': return CaseStatus.IN_PROGRESS;
    case 'PAYMENT_PLAN': return CaseStatus.PLAN_PENDING;
    case 'EXECUTION':
    case 'CLOSE': return CaseStatus.EXECUTING;
    default: return CaseStatus.IN_PROGRESS;
  }
}

/** 按角色 + 组织子树解析责任人 */
export function findUserByRoleInOrg(role: RoleCode, orgPath: string | null): number | null {
  if (!orgPath) return null;
  const r = getRow<{ id: number }>(
    `select u.id from app_user u
     join user_role ur on ur.user_id = u.id
     join role r on r.id = ur.role_id
     join org_unit o on o.id = u.org_id
     where r.code = ? and (o.path = ? or o.path like ?) and u.status='ACTIVE'
     order by u.id limit 1`,
    role, orgPath, `${orgPath}/%`
  );
  return r ? r.id : null;
}

export function findUserInDept(orgId: number): number | null {
  const r = getRow<{ id: number }>(
    `select id from app_user where org_id = ? and status='ACTIVE' order by id limit 1`, orgId
  );
  return r ? r.id : null;
}

export interface CaseLite {
  id: number;
  owner_id: number | null;
  org_id: number;
  org_path: string;
  internal_dept_id: number | null;
  reason_type: string;
}

/** 解析某节点的责任人（按冻结规格） */
export function resolveAssignee(spec: StageSpec, c: CaseLite): { userId: number | null; deptId: number | null } {
  switch (spec.ownerRole) {
    case RoleCode.SALES:
      return { userId: c.owner_id, deptId: c.org_id };
    case RoleCode.DEPT_SUPERVISOR: {
      const u = findUserByRoleInOrg(RoleCode.DEPT_SUPERVISOR, c.org_path) || findUserByRoleInOrg(RoleCode.AR_MANAGER, null) || findUserByRoleInOrg(RoleCode.AR_MANAGER, '/1');
      return { userId: u, deptId: c.org_id };
    }
    case RoleCode.BU_HEAD: {
      const u = findUserByRoleInOrg(RoleCode.BU_HEAD, c.org_path);
      return { userId: u, deptId: c.org_id };
    }
    case RoleCode.AR_MANAGER: {
      const u = findUserByRoleInOrg(RoleCode.AR_MANAGER, '/1');
      return { userId: u, deptId: null };
    }
    case RoleCode.LEGAL: {
      const u = findUserByRoleInOrg(RoleCode.LEGAL, '/1');
      return { userId: u, deptId: null };
    }
    default:
      if (c.internal_dept_id) {
        const u = findUserInDept(c.internal_dept_id);
        return { userId: u, deptId: c.internal_dept_id };
      }
      return { userId: c.owner_id, deptId: c.org_id };
  }
}

export { now };
