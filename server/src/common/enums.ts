// 业务术语与代码标识（对齐架构方案附录 B）

export enum CaseStatus {
  PENDING_ASSIGN = 'PENDING_ASSIGN', // 待分派
  REASON_CHECK = 'REASON_CHECK', // 原因核实 / 责任分流
  INTERNAL_RECTIFY = 'INTERNAL_RECTIFY', // 内部整改
  IN_PROGRESS = 'IN_PROGRESS', // 跟进中（催收 / 对账）
  PLAN_PENDING = 'PLAN_PENDING', // 方案待审
  EXECUTING = 'EXECUTING', // 执行中
  SETTLED = 'SETTLED', // 已结清
  WRITTEN_OFF = 'WRITTEN_OFF', // 已核销
  LEGAL = 'LEGAL' // 已移交法务
}

export const TERMINAL_STATUSES = new Set([CaseStatus.SETTLED, CaseStatus.WRITTEN_OFF, CaseStatus.LEGAL]);

export const STATUS_LABEL: Record<string, string> = {
  PENDING_ASSIGN: '待分派', REASON_CHECK: '原因核实', INTERNAL_RECTIFY: '内部整改',
  IN_PROGRESS: '跟进中', PLAN_PENDING: '方案待审', EXECUTING: '执行中',
  SETTLED: '已结清', WRITTEN_OFF: '已核销', LEGAL: '已移交法务'
};

export enum StageStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  DONE = 'DONE',
  SKIPPED = 'SKIPPED',
  CANCELLED = 'CANCELLED'
}

export enum ReasonType {
  PENDING = 'PENDING', // 待核实
  INTERNAL_DOC = 'INTERNAL_DOC', // 我方单据
  CUSTOMER_CASH = 'CUSTOMER_CASH', // 客户资金
  DISPUTE = 'DISPUTE', // 商务争议
  CHANNEL = 'CHANNEL', // 渠道压货
  RELATED_PARTY = 'RELATED_PARTY' // 关联方
}

export const REASON_LABEL: Record<ReasonType, string> = {
  PENDING: '待核实',
  INTERNAL_DOC: '我方单据',
  CUSTOMER_CASH: '客户资金',
  DISPUTE: '商务争议',
  CHANNEL: '渠道压货',
  RELATED_PARTY: '关联方'
};

// 原因分组：是否进入对外催收口径
export function reasonGroup(r: ReasonType): 'INTERNAL' | 'COLLECTION' | 'RELATED' {
  if (r === ReasonType.INTERNAL_DOC) return 'INTERNAL';
  if (r === ReasonType.RELATED_PARTY) return 'RELATED';
  if (r === ReasonType.PENDING) return 'COLLECTION';
  return 'COLLECTION';
}

export enum AgingBucket {
  LT1Y = 'LT1Y',
  Y1_2 = 'Y1_2',
  Y2_3 = 'Y2_3',
  GT3Y = 'GT3Y'
}

export const AGING_LABEL: Record<AgingBucket, string> = {
  LT1Y: '1 年以内',
  Y1_2: '1–2 年',
  Y2_3: '2–3 年',
  GT3Y: '3 年以上'
};

export enum RiskLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL'
}

export const RISK_LABEL: Record<RiskLevel, string> = {
  LOW: '低',
  MEDIUM: '中',
  HIGH: '高',
  CRITICAL: '极高'
};

export enum RoleCode {
  SYS_ADMIN = 'SYS_ADMIN',
  AR_MANAGER = 'AR_MANAGER',
  GROUP_LEADER = 'GROUP_LEADER',
  BU_HEAD = 'BU_HEAD',
  DEPT_SUPERVISOR = 'DEPT_SUPERVISOR',
  SALES = 'SALES',
  LEGAL = 'LEGAL',
  AUDITOR = 'AUDITOR'
}

export const ROLE_LABEL: Record<RoleCode, string> = {
  SYS_ADMIN: '系统管理员',
  AR_MANAGER: '应收管理岗',
  GROUP_LEADER: '集团分管领导',
  BU_HEAD: '事业部负责人',
  DEPT_SUPERVISOR: '销售部门主管',
  SALES: '销售员',
  LEGAL: '法务',
  AUDITOR: '审计 / 纪检'
};

export enum ScopeType {
  NONE = 'NONE',
  ALL = 'ALL',
  ORG_SUBTREE = 'ORG_SUBTREE',
  SELF = 'SELF',
  ASSIGNED = 'ASSIGNED',
  TEMP = 'TEMP'
}

export enum SlaUnit {
  WORKDAY = 'WORKDAY',
  NATURAL = 'NATURAL',
  HOUR = 'HOUR'
}

export enum EvidenceType {
  ERP_SYNC_RECORD = 'ERP_SYNC_RECORD',
  REASON_CLASSIFY = 'REASON_CLASSIFY',
  CUSTOMER_CONFIRM = 'CUSTOMER_CONFIRM',
  ROUTING_CONCLUSION = 'ROUTING_CONCLUSION',
  DUNNING_RECORD = 'DUNNING_RECORD',
  DEMAND_LETTER = 'DEMAND_LETTER',
  SIGNED_STATEMENT = 'SIGNED_STATEMENT',
  PAYMENT_PLAN = 'PAYMENT_PLAN',
  OA_APPROVAL = 'OA_APPROVAL',
  FOLLOWUP_RECORD = 'FOLLOWUP_RECORD',
  CLOSE_NOTE = 'CLOSE_NOTE',
  TRANSFER = 'TRANSFER',
  WRITE_OFF_APPROVAL = 'WRITE_OFF_APPROVAL',
  PHOTO = 'PHOTO',
  OTHER = 'OTHER'
}

export const EVIDENCE_LABEL: Record<EvidenceType, string> = {
  ERP_SYNC_RECORD: 'ERP 同步记录',
  REASON_CLASSIFY: '原因分类',
  CUSTOMER_CONFIRM: '客户确认记录',
  ROUTING_CONCLUSION: '分流结论',
  DUNNING_RECORD: '催收记录',
  DEMAND_LETTER: '催款函送达凭证',
  SIGNED_STATEMENT: '双方签章对账单',
  PAYMENT_PLAN: '还款计划',
  OA_APPROVAL: 'OA 审批号',
  FOLLOWUP_RECORD: '跟进记录',
  CLOSE_NOTE: '关闭说明',
  TRANSFER: '移交单',
  WRITE_OFF_APPROVAL: '核销审批号',
  PHOTO: '现场照片',
  OTHER: '其他凭证'
};

export enum BlockerCode {
  STAGE_NOT_ASSIGNEE = 'STAGE_NOT_ASSIGNEE',
  PREV_STAGE_INCOMPLETE = 'PREV_STAGE_INCOMPLETE',
  EVIDENCE_MISSING = 'EVIDENCE_MISSING',
  REASON_UNCLASSIFIED = 'REASON_UNCLASSIFIED',
  INTERNAL_DEPT_REQUIRED = 'INTERNAL_DEPT_REQUIRED',
  SKIP_APPROVAL_REQUIRED = 'SKIP_APPROVAL_REQUIRED',
  CASE_PAUSED = 'CASE_PAUSED',
  CASE_TERMINAL = 'CASE_TERMINAL',
  DELAY_REASON_REQUIRED = 'DELAY_REASON_REQUIRED'
}

export interface Blocker {
  code: BlockerCode;
  message: string;
  evidenceType?: EvidenceType;
  fix?: string;
}

export interface ApiError {
  code: string;
  message: string;
  traceId?: string;
  details?: unknown[];
}
