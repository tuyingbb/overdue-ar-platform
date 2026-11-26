import { run, allRows, getRow, scalar, tx, exec } from '../db/index.js';
import { RoleCode, ScopeType, ReasonType, AgingBucket, RiskLevel, CaseStatus, StageStatus, SlaUnit, EvidenceType } from '../common/enums.js';
import { jstring, hashPassword, genSalt, now } from '../common/util.js';
import { instantiateCase, computeDueAt, readStageSpec, resolveAssignee, type StageSpec, type CaseLite } from '../flow/engine.js';
import { shDate } from '../flow/calendar.js';

const PWD = '123456';

function roleId(code: string): number {
  return (getRow<{ id: number }>(`select id from role where code=?`, code)?.id ?? 0) as number;
}
function userId(emp: string): number {
  return (getRow<{ id: number }>(`select id from app_user where employee_no=?`, emp)?.id ?? 0) as number;
}

const STAGE_DEFS: StageSpec[] = [
  { code: 'INTAKE', seq: 1, name: '逾期入账', ownerRole: RoleCode.AR_MANAGER, slaValue: 0, slaUnit: SlaUnit.HOUR, blockNext: true, isTerminal: false,
    evidence: [{ code: EvidenceType.ERP_SYNC_RECORD, name: 'ERP 同步记录', required: true }], escalation: [], next: { default: 'REASON_CHECK' } },
  { code: 'REASON_CHECK', seq: 2, name: '原因核实', ownerRole: RoleCode.SALES, slaValue: 3, slaUnit: SlaUnit.WORKDAY, blockNext: true, isTerminal: false,
    evidence: [{ code: EvidenceType.REASON_CLASSIFY, name: '原因分类', required: true }, { code: EvidenceType.CUSTOMER_CONFIRM, name: '客户确认记录', required: true }],
    escalation: [{ level: 1, thresholdWorkdays: 1, target: 'ASSIGNEE' }, { level: 2, thresholdWorkdays: 3, target: 'ASSIGNEE_SUPERVISOR' }, { level: 3, thresholdWorkdays: 7, target: 'ESCALATION_POOL' }],
    next: { default: 'ROUTING' } },
  { code: 'ROUTING', seq: 3, name: '责任分流', ownerRole: RoleCode.DEPT_SUPERVISOR, slaValue: 1, slaUnit: SlaUnit.WORKDAY, blockNext: true, isTerminal: false,
    evidence: [{ code: EvidenceType.ROUTING_CONCLUSION, name: '分流结论', required: true }],
    escalation: [{ level: 1, thresholdWorkdays: 1, target: 'ASSIGNEE' }, { level: 2, thresholdWorkdays: 2, target: 'ASSIGNEE_SUPERVISOR' }],
    next: { default: 'FIRST_DUNNING', routing: { [ReasonType.INTERNAL_DOC]: 'RECTIFY' } } },
  { code: 'RECTIFY', seq: 4, name: '内部整改', ownerRole: RoleCode.SALES, slaValue: 5, slaUnit: SlaUnit.WORKDAY, blockNext: true, isTerminal: false,
    evidence: [{ code: EvidenceType.FOLLOWUP_RECORD, name: '补单/整改记录', required: true }],
    escalation: [{ level: 1, thresholdWorkdays: 2, target: 'ASSIGNEE' }, { level: 2, thresholdWorkdays: 5, target: 'ASSIGNEE_SUPERVISOR' }],
    next: { default: 'FIRST_DUNNING' } },
  { code: 'FIRST_DUNNING', seq: 5, name: '首次催收', ownerRole: RoleCode.SALES, slaValue: 3, slaUnit: SlaUnit.WORKDAY, blockNext: true, isTerminal: false,
    evidence: [{ code: EvidenceType.DUNNING_RECORD, name: '催收记录', required: true }, { code: EvidenceType.DEMAND_LETTER, name: '催款函送达凭证', required: true }],
    escalation: [{ level: 1, thresholdWorkdays: 1, target: 'ASSIGNEE' }, { level: 2, thresholdWorkdays: 3, target: 'ASSIGNEE_SUPERVISOR' }, { level: 3, thresholdWorkdays: 7, target: 'ESCALATION_POOL' }],
    next: { default: 'RECONCILE' } },
  { code: 'RECONCILE', seq: 6, name: '对账确认', ownerRole: RoleCode.SALES, slaValue: 5, slaUnit: SlaUnit.NATURAL, blockNext: true, isTerminal: false,
    evidence: [{ code: EvidenceType.SIGNED_STATEMENT, name: '双方签章对账单', required: true }],
    escalation: [{ level: 1, thresholdWorkdays: 2, target: 'ASSIGNEE' }, { level: 2, thresholdWorkdays: 5, target: 'ASSIGNEE_SUPERVISOR' }],
    next: { default: 'PAYMENT_PLAN' } },
  { code: 'PAYMENT_PLAN', seq: 7, name: '还款方案', ownerRole: RoleCode.DEPT_SUPERVISOR, slaValue: 2, slaUnit: SlaUnit.WORKDAY, blockNext: true, isTerminal: false,
    evidence: [{ code: EvidenceType.PAYMENT_PLAN, name: '还款计划', required: true }, { code: EvidenceType.OA_APPROVAL, name: 'OA 审批号', required: true }],
    escalation: [{ level: 1, thresholdWorkdays: 1, target: 'ASSIGNEE' }, { level: 2, thresholdWorkdays: 3, target: 'ASSIGNEE_SUPERVISOR' }],
    next: { default: 'EXECUTION' } },
  { code: 'EXECUTION', seq: 8, name: '执行跟进', ownerRole: RoleCode.SALES, slaValue: 5, slaUnit: SlaUnit.NATURAL, blockNext: true, isTerminal: false,
    evidence: [{ code: EvidenceType.FOLLOWUP_RECORD, name: '跟进记录', required: true }],
    escalation: [{ level: 1, thresholdWorkdays: 2, target: 'ASSIGNEE' }, { level: 2, thresholdWorkdays: 5, target: 'ASSIGNEE_SUPERVISOR' }, { level: 3, thresholdWorkdays: 10, target: 'ESCALATION_POOL' }],
    next: { default: 'CLOSE' } },
  { code: 'CLOSE', seq: 9, name: '关闭/移交', ownerRole: RoleCode.AR_MANAGER, slaValue: 3, slaUnit: SlaUnit.WORKDAY, blockNext: false, isTerminal: true,
    evidence: [{ code: EvidenceType.CLOSE_NOTE, name: '关闭说明', required: true }, { code: EvidenceType.TRANSFER, name: '移交单', required: false }, { code: EvidenceType.WRITE_OFF_APPROVAL, name: '核销审批号', required: false }],
    escalation: [], next: {} }
];

function insertStages(templateId: number) {
  for (const s of STAGE_DEFS) {
    run(`insert into stage_def(template_id,code,seq,name,owner_role,sla_value,sla_unit,evidence_json,escalation_json,next_json,block_next,is_terminal)
         values(?,?,?,?,?,?,?,?,?,?,?,?)`,
      templateId, s.code, s.seq, s.name, s.ownerRole, s.slaValue, s.slaUnit,
      jstring(s.evidence), jstring(s.escalation), jstring(s.next), s.blockNext ? 1 : 0, s.isTerminal ? 1 : 0);
  }
}

function setStage(caseId: number, code: string, patch: Record<string, unknown>) {
  const sets = Object.keys(patch).map((k) => `${k}=?`).join(',');
  run(`update case_stage set ${sets} where case_id=? and stage_code=?`, ...Object.values(patch), caseId, code);
}

function stageId(caseId: number, code: string): number {
  return (getRow<{ id: number }>(`select id from case_stage where case_id=? and stage_code=?`, caseId, code)?.id ?? 0) as number;
}
function caseLite(caseId: number): CaseLite {
  const c = getRow<{ owner_id: number | null; org_id: number; internal_dept_id: number | null; reason_type: string }>(
    `select owner_id, org_id, internal_dept_id, reason_type from overdue_case where id=?`, caseId
  )!;
  const op = getRow<{ path: string }>(`select path from org_unit where id=?`, c.org_id)!.path;
  return { id: caseId, owner_id: c.owner_id, org_id: c.org_id, org_path: op, internal_dept_id: c.internal_dept_id, reason_type: c.reason_type };
}

function addEvidence(caseId: number, stageCode: string, type: EvidenceType, name: string, by: number) {
  const sid = stageId(caseId, stageCode);
  run(`insert into evidence(case_id, stage_id, type, name, uploaded_by, bound) values(?,?,?,?,?,1)`, caseId, sid, type, name, by);
}

function addTransition(caseId: number, event: string, from: string | null, to: string | null, stage: string | null, op: number | null, note: string, when: string) {
  run(`insert into case_transition(case_id,event,from_status,to_status,stage_code,operator_id,note,occurred_at) values(?,?,?,?,?,?,?,?)`,
    caseId, event, from, to, stage, op, note, when);
}

interface CaseSeed {
  caseNo: string; erpArId: string; customer: string; contract?: string; amountWan: number; days: number; aging: AgingBucket;
  reason: ReasonType; internalDept?: number; risk: RiskLevel; ownerEmp: string; orgId: number;
  current: string; status: CaseStatus; overdueHours?: number; escalation?: number; dueFutureHours?: number;
  skipStages?: string[]; ownerEmpForStage?: Record<string, string>;
}

function makeCase(s: CaseSeed, v1Id: number) {
  return tx(() => {
    const ownerId = userId(s.ownerEmp);
    const cents = Math.round(s.amountWan * 10000 * 100);
    const r = run(`insert into overdue_case(case_no,erp_ar_id,customer_id,customer_name,contract_no,overdue_amount_cents,aging_bucket,overdue_days,reason_type,internal_dept_id,risk_level,owner_id,org_id,case_status,template_version_id,erp_synced_at,row_version)
       values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),0)`,
      s.caseNo, s.erpArId, 'C' + s.erpArId, s.customer, s.contract || null, cents, s.aging, s.days, s.reason, s.internalDept || null, s.risk, ownerId, s.orgId, s.status, v1Id);
    const caseId = Number(r.lastInsertRowid);
    instantiateCase(caseId, v1Id);
    const all = allRows<{ stage_code: string; seq: number; spec_snapshot: string }>(`select stage_code, seq, spec_snapshot from case_stage where case_id=? order by seq`, caseId);
    const tgtSeq = all.find((a) => a.stage_code === s.current)?.seq ?? 99;
    const nowMs = Date.now();
    const iso = (ms: number) => new Date(ms).toISOString();
    // 终态处理
    const terminal = [CaseStatus.SETTLED, CaseStatus.LEGAL, CaseStatus.WRITTEN_OFF].includes(s.status);
    for (const a of all) {
      const spec = readStageSpec(a);
      const opId = s.ownerEmpForStage?.[a.stage_code] ? userId(s.ownerEmpForStage[a.stage_code]!) : ownerId;
      const ass = resolveAssignee(spec, { ...caseLite(caseId), reason_type: s.reason } as CaseLite);
      const realAssignee = (spec.ownerRole === RoleCode.SALES && s.internalDept && a.stage_code === 'RECTIFY')
        ? (getRow<{ id: number }>(`select id from app_user where org_id=? and status='ACTIVE' order by id limit 1`, s.internalDept)?.id ?? opId)
        : (ass.userId ?? opId);
      if (terminal) {
        setStage(caseId, a.stage_code, { status: a.stage_code === 'CLOSE' ? StageStatus.DONE : StageStatus.CANCELLED, completed_at: iso(nowMs - 86400000), assignee_id: realAssignee });
        continue;
      }
      if (a.seq < tgtSeq) {
        // 已完成：补齐必传凭证
        setStage(caseId, a.stage_code, { status: StageStatus.DONE, started_at: iso(nowMs - (tgtSeq - a.seq + 1) * 86400000), completed_at: iso(nowMs - (tgtSeq - a.seq) * 86400000), assignee_id: realAssignee, overdue_hours: 0 });
        for (const e of spec.evidence) if (e.required) addEvidence(caseId, a.stage_code, e.code as EvidenceType, e.name, realAssignee);
      } else if (a.seq === tgtSeq) {
        let dueIso: string;
        let startedIso: string;
        let oh = 0;
        if (s.overdueHours && s.overdueHours > 0) {
          oh = s.overdueHours;
          dueIso = iso(nowMs - oh * 3600000);
          startedIso = iso(nowMs - (oh + spec.slaValue * 24) * 3600000);
        } else if (s.dueFutureHours) {
          dueIso = iso(nowMs + s.dueFutureHours * 3600000);
          startedIso = iso(nowMs - 6 * 3600000);
        } else {
          const due = computeDueAt(spec, new Date(nowMs - 6 * 3600000));
          dueIso = due.toISOString(); startedIso = iso(nowMs - 6 * 3600000);
        }
        setStage(caseId, a.stage_code, { status: StageStatus.ACTIVE, started_at: startedIso, due_at: dueIso, assignee_id: realAssignee, overdue_hours: oh, escalation_level: s.escalation || 0 });
      } else {
        setStage(caseId, a.stage_code, { assignee_id: realAssignee });
      }
    }
    // 当前节点 id
    const curSid = terminal ? null : stageId(caseId, s.current);
    const curOwner = terminal ? ownerId : (() => {
      const a = all.find((x) => x.stage_code === s.current)!;
      const spec = readStageSpec(a);
      if (spec.ownerRole === RoleCode.SALES) return ownerId;
      return resolveAssignee(spec, { ...caseLite(caseId), reason_type: s.reason } as CaseLite).userId ?? ownerId;
    })();
    run(`update overdue_case set current_stage_id=?, owner_id=?, case_status=? where id=?`, curSid, curOwner, s.status, caseId);
    // 时间轴
    addTransition(caseId, 'CASE_CREATED', null, CaseStatus.PENDING_ASSIGN, 'INTAKE', userId('wangfang'), 'ERP 同步入账', iso(nowMs - s.days * 86400000));
    if (s.reason !== ReasonType.PENDING) addTransition(caseId, 'REASON_CLASSIFIED', ReasonType.PENDING, s.reason, 'REASON_CHECK', ownerId, `原因：${s.reason}`, iso(nowMs - (s.days - 2) * 86400000));
    if (!terminal) {
      const done = all.filter((a) => a.seq < tgtSeq);
      for (const a of done) addTransition(caseId, 'STAGE_COMPLETED', s.status, s.status, a.stage_code, ownerId, `完成「${a.stage_code}」，进入下一节点`, iso(nowMs - (tgtSeq - a.seq) * 86400000));
    }
    if (terminal) addTransition(caseId, 'CASE_CLOSED', CaseStatus.IN_PROGRESS, s.status, 'CLOSE', userId('wangfang'), s.status === CaseStatus.LEGAL ? '移交法务' : '已结清', iso(nowMs - 2 * 86400000));
    // 升级事件
    if (s.escalation && s.escalation > 0) {
      run(`insert or ignore into escalation_event(stage_id, case_id, level, triggered_at) values(?,?,?,datetime('now'))`, curSid, caseId, s.escalation);
    }
    return caseId;
  });
}

export function seed(): { didRun: boolean } {
  const exists = (scalar<number>(`select count(*) from app_user`) ?? 0) as number;
  if (exists > 0) return { didRun: false };

  tx(() => {
    // 角色
    const roles: [RoleCode, string, ScopeType, number][] = [
      [RoleCode.SYS_ADMIN, '系统管理员', ScopeType.NONE, 0],
      [RoleCode.AR_MANAGER, '应收管理岗', ScopeType.ALL, 1],
      [RoleCode.GROUP_LEADER, '集团分管领导', ScopeType.ALL, 1],
      [RoleCode.BU_HEAD, '事业部负责人', ScopeType.ORG_SUBTREE, 1],
      [RoleCode.DEPT_SUPERVISOR, '销售部门主管', ScopeType.ORG_SUBTREE, 1],
      [RoleCode.SALES, '销售员', ScopeType.SELF, 1],
      [RoleCode.LEGAL, '法务', ScopeType.ASSIGNED, 1],
      [RoleCode.AUDITOR, '审计 / 纪检', ScopeType.ALL, 1]
    ];
    for (const [code, name, scope, amt] of roles) run(`insert into role(code,name,scope_type,amount_visible) values(?,?,?,?)`, code, name, scope, amt);

    // 组织
    const orgs: [number, number | null, string, string, number, string][] = [
      [1, null, '/1', '集团', 1, 'GROUP'],
      [2, 1, '/1/2', '华北事业部', 2, 'BU'],
      [3, 2, '/1/2/3', '华北销售一部', 3, 'DEPT'],
      [4, 2, '/1/2/4', '华北销售二部', 3, 'DEPT'],
      [5, 2, '/1/2/5', '华北销售三部', 3, 'DEPT'],
      [6, 2, '/1/2/6', '工程部', 3, 'DEPT'],
      [7, 1, '/1/7', '华东事业部', 2, 'BU'],
      [8, 7, '/1/7/8', '华东销售一部', 3, 'DEPT'],
      [9, 1, '/1/9', '集团财务部', 2, 'DEPT'],
      [10, 1, '/1/10', '法务部', 2, 'DEPT'],
      [11, 1, '/1/11', '审计部', 2, 'DEPT']
    ];
    for (const [id, pid, path, name, level, type] of orgs) run(`insert into org_unit(id,parent_id,path,name,level,type) values(?,?,?,?,?,?)`, id, pid, path, name, level, type);

    // 用户
    const users: [string, string, number][] = [
      ['admin', '系统管理员', 1], ['wangfang', '王芳', 9], ['zhaozong', '赵总', 1], ['liuzong', '刘总', 2],
      ['wangqiang', '王强', 3], ['liwei', '李伟', 3], ['chenli', '陈立', 4], ['zhangmin', '张敏', 5],
      ['liuzhen', '刘振', 3], ['sunyue', '孙悦', 3], ['wanghaitao', '王海涛', 3], ['zhouming', '周明', 10],
      ['lishen', '李审', 11], ['zhaoqiang', '赵强', 6], ['linda', '林达', 8], ['zhenghua', '郑华', 8], ['qianwei', '钱伟', 7]
    ];
    for (const [emp, name, org] of users) {
      const salt = genSalt();
      run(`insert into app_user(employee_no,name,org_id,password_hash,salt) values(?,?,?,?,?)`, emp, name, org, hashPassword(PWD, salt), salt);
    }
    // 用户角色
    const userRoles: [string, RoleCode][] = [
      ['admin', RoleCode.SYS_ADMIN], ['wangfang', RoleCode.AR_MANAGER], ['zhaozong', RoleCode.GROUP_LEADER],
      ['liuzong', RoleCode.BU_HEAD], ['wangqiang', RoleCode.DEPT_SUPERVISOR], ['liwei', RoleCode.SALES],
      ['chenli', RoleCode.SALES], ['zhangmin', RoleCode.SALES], ['liuzhen', RoleCode.SALES], ['sunyue', RoleCode.SALES],
      ['wanghaitao', RoleCode.SALES], ['zhouming', RoleCode.LEGAL], ['lishen', RoleCode.AUDITOR],
      ['zhaoqiang', RoleCode.SALES], ['linda', RoleCode.SALES], ['zhenghua', RoleCode.DEPT_SUPERVISOR], ['qianwei', RoleCode.BU_HEAD]
    ];
    for (const [emp, role] of userRoles) run(`insert into user_role(user_id, role_id, org_id) values(?,?,?)`, userId(emp), roleId(role), null);

    // 给审计「李审」加字段级授权：金额不可见（演示脱敏），合同号不可见
    run(`insert into data_grant(subject_id, scope_type, amount_visible, customer_visible, contract_visible) values(?,?,0,1,0)`, userId('lishen'), ScopeType.ALL);

    // 工作日历：2026-11 ~ 2026-12，标记一个节假日
    const start = new Date('2026-11-01');
    for (let i = 0; i < 70; i++) {
      const d = new Date(start.getTime() + i * 86400000);
      const day = d.getUTCDay();
      const isWork = day !== 0 && day !== 6;
      run(`insert or ignore into work_calendar(cal_date, is_workday) values(?,?)`, shDate(d), isWork ? 1 : 0);
    }
    run(`update work_calendar set is_workday=0, remark='法定节假日' where cal_date='2026-12-01'`);

    // 模板 v1 已发布 + v2 草稿
    const v1 = run(`insert into flow_template(code,name,version,status,published_by,published_at,created_by) values(?,?,1,'PUBLISHED',?,datetime('now'),?)`,
      'TPL-AR-STD', '应收账款逾期跟进流程', userId('admin'), userId('admin'));
    const v1Id = Number(v1.lastInsertRowid);
    insertStages(v1Id);
    const v2 = run(`insert into flow_template(code,name,version,status,created_by) values(?,?,2,'DRAFT',?)`, 'TPL-AR-STD', '应收账款逾期跟进流程', userId('admin'));
    insertStages(Number(v2.lastInsertRowid));
    // 调整 v2 草稿一个节点以体现差异：把首次催收 SLA 从 3 改 2（演示配置）
    run(`update stage_def set sla_value=2 where template_id=? and code='FIRST_DUNNING'`, Number(v2.lastInsertRowid));

    // 事项
    const cases: CaseSeed[] = [
      { caseNo: 'OD-202611-0142', erpArId: 'AR2026110142', customer: '华北重型装备', contract: 'HT-2025-0892', amountWan: 386.0, days: 41, aging: AgingBucket.Y1_2, reason: ReasonType.INTERNAL_DOC, internalDept: 6, risk: RiskLevel.HIGH, ownerEmp: 'liwei', orgId: 3, current: 'RECONCILE', status: CaseStatus.IN_PROGRESS, overdueHours: 26, escalation: 1 },
      { caseNo: 'OD-202611-0138', erpArId: 'AR2026110138', customer: '中冶东方重工', contract: 'HT-2025-0671', amountWan: 742.5, days: 92, aging: AgingBucket.Y1_2, reason: ReasonType.CUSTOMER_CASH, risk: RiskLevel.HIGH, ownerEmp: 'wanghaitao', orgId: 3, current: 'PAYMENT_PLAN', status: CaseStatus.PLAN_PENDING, dueFutureHours: 12 },
      { caseNo: 'OD-202611-0121', erpArId: 'AR2026110121', customer: '江苏恒远机械', contract: 'HT-2026-0103', amountWan: 128.4, days: 18, aging: AgingBucket.LT1Y, reason: ReasonType.DISPUTE, risk: RiskLevel.MEDIUM, ownerEmp: 'zhangmin', orgId: 5, current: 'RECONCILE', status: CaseStatus.IN_PROGRESS, dueFutureHours: 48 },
      { caseNo: 'OD-202611-0117', erpArId: 'AR2026110117', customer: '山东齐鲁钢构', contract: 'HT-2026-0211', amountWan: 96.8, days: 7, aging: AgingBucket.LT1Y, reason: ReasonType.PENDING, risk: RiskLevel.MEDIUM, ownerEmp: 'liuzhen', orgId: 3, current: 'REASON_CHECK', status: CaseStatus.REASON_CHECK, dueFutureHours: 8 },
      { caseNo: 'OD-202611-0109', erpArId: 'AR2026110109', customer: '西南交建物资', contract: 'HT-2025-1120', amountWan: 512.0, days: 126, aging: AgingBucket.Y1_2, reason: ReasonType.CHANNEL, risk: RiskLevel.CRITICAL, ownerEmp: 'chenli', orgId: 4, current: 'FIRST_DUNNING', status: CaseStatus.IN_PROGRESS, overdueHours: 72, escalation: 2 },
      { caseNo: 'OD-202611-0098', erpArId: 'AR2026110098', customer: '天津港机集团', contract: 'HT-2025-0998', amountWan: 204.6, days: 33, aging: AgingBucket.LT1Y, reason: ReasonType.INTERNAL_DOC, internalDept: 6, risk: RiskLevel.MEDIUM, ownerEmp: 'wanghaitao', orgId: 3, current: 'RECTIFY', status: CaseStatus.INTERNAL_RECTIFY, dueFutureHours: 36 },
      { caseNo: 'OD-202611-0087', erpArId: 'AR2026110087', customer: '辽宁北方重装', contract: 'HT-2024-1550', amountWan: 88.2, days: 215, aging: AgingBucket.Y2_3, reason: ReasonType.DISPUTE, risk: RiskLevel.HIGH, ownerEmp: 'zhouming', orgId: 4, current: 'CLOSE', status: CaseStatus.LEGAL },
      { caseNo: 'OD-202611-0076', erpArId: 'AR2026110076', customer: '浙江远东机电', contract: 'HT-2026-0044', amountWan: 46.3, days: 4, aging: AgingBucket.LT1Y, reason: ReasonType.CUSTOMER_CASH, risk: RiskLevel.LOW, ownerEmp: 'sunyue', orgId: 3, current: 'FIRST_DUNNING', status: CaseStatus.IN_PROGRESS, dueFutureHours: 6 },
      { caseNo: 'OD-202611-0065', erpArId: 'AR2026110065', customer: '北京京城重工', contract: 'HT-2026-0167', amountWan: 310.0, days: 56, aging: AgingBucket.Y1_2, reason: ReasonType.CUSTOMER_CASH, risk: RiskLevel.MEDIUM, ownerEmp: 'liwei', orgId: 3, current: 'FIRST_DUNNING', status: CaseStatus.IN_PROGRESS, dueFutureHours: 4 },
      { caseNo: 'OD-202611-0050', erpArId: 'AR2026110050', customer: '河北冀东装备', contract: 'HT-2025-1203', amountWan: 156.0, days: 64, aging: AgingBucket.Y1_2, reason: ReasonType.RELATED_PARTY, risk: RiskLevel.MEDIUM, ownerEmp: 'liwei', orgId: 3, current: 'ROUTING', status: CaseStatus.REASON_CHECK, dueFutureHours: 20 },
      { caseNo: 'OD-202611-0201', erpArId: 'AR2026110201', customer: '上海宝钢工程', contract: 'HT-2026-0089', amountWan: 278.0, days: 38, aging: AgingBucket.Y1_2, reason: ReasonType.CUSTOMER_CASH, risk: RiskLevel.HIGH, ownerEmp: 'linda', orgId: 8, current: 'RECONCILE', status: CaseStatus.IN_PROGRESS, dueFutureHours: 30 },
      { caseNo: 'OD-202610-0188', erpArId: 'AR2026100188', customer: '太原重工股份', contract: 'HT-2024-2210', amountWan: 64.0, days: 730, aging: AgingBucket.Y2_3, reason: ReasonType.INTERNAL_DOC, internalDept: 6, risk: RiskLevel.MEDIUM, ownerEmp: 'wanghaitao', orgId: 3, current: 'CLOSE', status: CaseStatus.SETTLED },
      { caseNo: 'OD-202609-0070', erpArId: 'AR2026090070', customer: '大连船用机械厂', contract: 'HT-2024-0901', amountWan: 410.0, days: 402, aging: AgingBucket.GT3Y, reason: ReasonType.CHANNEL, risk: RiskLevel.CRITICAL, ownerEmp: 'chenli', orgId: 4, current: 'EXECUTION', status: CaseStatus.EXECUTING, overdueHours: 120, escalation: 3 }
    ];
    for (const c of cases) makeCase(c, v1Id);

    // 给李伟在 OD-202611-0142 的「首次催收」补两条已上传凭证（演示时间轴）
    const c142 = getRow<{ id: number }>(`select id from overdue_case where case_no='OD-202611-0142'`)!;
    addEvidence(c142.id, 'FIRST_DUNNING', EvidenceType.DUNNING_RECORD, '电话催收记录（客户承诺本周付款）', userId('liwei'));
    addEvidence(c142.id, 'FIRST_DUNNING', EvidenceType.DEMAND_LETTER, '催款函 EMS 签收底单', userId('liwei'));
    // 沟通记录
    run(`insert into communication_log(case_id,channel,contact,conclusion,next_commitment_at,operator_id) values(?,?,?,?,?,?)`,
      c142.id, '电话', '华北重型·采购经理', '客户称验收单已走内部签批，预计 3 日内回传对账单', new Date(Date.now() + 3 * 86400000).toISOString(), userId('liwei'));
  });

  return { didRun: true };
}
