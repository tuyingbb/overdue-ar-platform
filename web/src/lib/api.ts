export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...((init.headers as Record<string, string>) || {}) };
  const res = await fetch(path, { credentials: 'include', ...init, headers });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (res.status === 401) {
    if (!location.pathname.startsWith('/login')) location.href = '/login';
    throw new ApiError(401, 'UNAUTHORIZED', '未登录或登录已过期');
  }
  if (!res.ok) {
    throw new ApiError(res.status, data?.code || 'HTTP_ERROR', data?.message || res.statusText);
  }
  return data as T;
}

/* ============ 类型 ============ */
export interface Scope {
  type: string; orgId: number | null; orgPath: string | null;
  amountVisible: boolean; customerVisible: boolean; contractVisible: boolean;
}
export interface User {
  id: number; name: string; employeeNo: string; orgId: number; orgPath: string; orgName: string;
  roles: string[]; primaryRole: string; scope: Scope; perms: string[];
}
export interface DemoAccount { employeeNo: string; name: string; role: string; orgName: string; }

export interface CaseRow {
  id: number; caseNo: string; customerName: string; contractNo: string | null; salesOrderNo: string | null;
  overdueAmountCents: number; overdueAmountWan: string; currency: string; agingBucket: string; agingLabel: string;
  overdueDays: number; reasonType: string; reasonLabel: string; riskLevel: string; riskLabel: string;
  caseStatus: string; statusLabel: string; isPaused: boolean; ownerName: string; orgName: string;
  currentStageCode: string; currentStageName: string; overdueHours: number; stageId: number; maskedFields: string[];
}
export interface ReqEvidence { code: string; name: string; required: boolean; provided: boolean; }
export interface Stage {
  id: number; code: string; seq: number; name: string; status: string;
  assigneeId: number | null; assigneeName: string | null;
  startedAt: string | null; dueAt: string | null; completedAt: string | null;
  overdueHours: number; escalationLevel: number; isCurrent: boolean;
  requiredEvidence: ReqEvidence[];
}
export interface CaseDetail extends CaseRow {
  customerId: string; internalDeptId: number | null; internalDeptName: string | null;
  ownerId: number; orgId: number; erpSyncedAt: string; closedAt: string | null;
  createdAt: string; updatedAt: string; version: number; currentStageId: number | null;
  stages: Stage[];
}
export interface Blocker { code: string; message: string; fix?: string; }
export interface Warning { code: string; message: string; required?: boolean; }
export interface CompletionCheck {
  caseNo: string; version: number;
  stage: { code: string; name: string; status: string; dueAt: string | null; overdueHours: number; assigneeName: string | null; };
  canComplete: boolean; blockers: Blocker[]; warnings: Warning[];
  nextStage: { code: string; name: string; dueAtRule: string } | null;
}
export interface TimelineEntry {
  type: string; occurredAt: string; actor: string | null; note: string | null;
  event?: string; stage?: string; name?: string; channel?: string; [k: string]: any;
}
export interface EvidenceItem {
  id: number; type: string; typeLabel: string; name: string; note: string | null;
  uploadedAt: string; bound: boolean; stageId: number | null; uploadedBy: string | null;
}
export interface TaskItem {
  caseNo: string; customerName: string; amountWan: string; overdueDays: number;
  reasonType: string; reasonLabel: string; stageId: number; stageCode: string; stageName: string;
  dueAt: string | null; overdueHours: number; caseStatus: string; statusLabel: string; riskLevel: string;
  missing: string[]; blockers: string[]; group: string;
}
export interface Dashboard {
  kpi: { inProgress: number; overdue: number; dueThisWeek: number; settledThisMonth: number; totalAmountWan: string; };
  reasonDistribution: { reasonType: string; label: string; count: number; amountWan: string }[];
  agingDistribution: { bucket: string; label: string; count: number; amountWan: string }[];
  riskDistribution: { level: string; label: string; count: number }[];
  statusDistribution: { status: string; label: string; count: number }[];
  timeoutBoard: { caseNo: string; customerName: string; amountWan: string; stageName: string; overdueHours: number; ownerName: string; reasonLabel: string }[];
  blockers: { evidenceMissing: number; overdueCount: number; unclassified: number };
  orgEfficiency: any[];
}
export interface Template { id: number; code: string; name: string; version: number; status: string; published_at: string | null; created_at: string; }
export interface StageSpec { id?: number; code: string; seq: number; name: string; ownerRole: string; slaValue: number; slaUnit: string; evidence: any[]; escalation: any[]; next: any; blockNext: boolean; isTerminal: boolean; }
export interface TemplateDetail extends Template { stages: StageSpec[]; remark: string | null; published_by: number | null; }
export interface OrgNode { id: number; parent_id: number | null; name: string; path: string; level: number; }
export interface UserRow { id: number; name: string; employee_no: string; org_name: string; }
export interface Notice { id: number; title: string; content: string | null; read: number; created_at: string; [k: string]: any; }

/* ============ 接口 ============ */
export const api = {
  me: () => request<{ user: User }>('/auth/me'),
  demoAccounts: () => request<{ accounts: DemoAccount[] }>('/auth/demo-accounts'),
  login: (employeeNo: string, password: string) =>
    request<{ user: User }>('/auth/login', { method: 'POST', body: JSON.stringify({ employeeNo, password }) }),
  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),

  listCases: (q: Record<string, any> = {}) => {
    const sp = new URLSearchParams();
    Object.entries(q).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') sp.set(k, String(v)); });
    return request<{ list: CaseRow[]; total: number; page: number; pageSize: number }>(`/api/cases?${sp.toString()}`);
  },
  getCase: (caseNo: string) => request<CaseDetail>(`/api/cases/${caseNo}`),
  getTimeline: (caseNo: string) => request<{ list: TimelineEntry[] } | TimelineEntry[]>(`/api/cases/${caseNo}/timeline`),
  getEvidence: (caseNo: string) => request<{ list: EvidenceItem[] }>(`/api/cases/${caseNo}/evidence`),
  completionCheck: (caseNo: string, stageId: number) =>
    request<CompletionCheck>(`/api/cases/${caseNo}/completion-check?stageId=${stageId}`),
  completeStage: (caseNo: string, stageId: number, body: { version: number; note?: string; delayReason?: string }, idem: string) =>
    request<{ ok: boolean; caseNo: string; status: string; statusLabel: string; currentStageId: number; version: number }>(
      `/api/cases/${caseNo}/stages/${stageId}/complete`,
      { method: 'POST', body: JSON.stringify(body), headers: { 'Idempotency-Key': idem } }
    ),
  uploadEvidence: (caseNo: string, body: { stageId: number; type: string; name: string; note?: string }) =>
    request<{ ok: boolean; id: number; bound: boolean }>(`/api/cases/${caseNo}/evidence`, { method: 'POST', body: JSON.stringify(body) }),
  addCommunication: (caseNo: string, body: { channel: string; contact?: string; conclusion: string; nextCommitmentAt?: string }) =>
    request<{ ok: boolean }>(`/api/cases/${caseNo}/communication`, { method: 'POST', body: JSON.stringify(body) }),
  pauseCase: (caseNo: string, reason: string) => request(`/api/cases/${caseNo}/pause`, { method: 'POST', body: JSON.stringify({ reason }) }),
  resumeCase: (caseNo: string) => request(`/api/cases/${caseNo}/resume`, { method: 'POST' }),
  reassignCase: (caseNo: string, newOwnerId: number, reason: string) =>
    request(`/api/cases/${caseNo}/reassign`, { method: 'POST', body: JSON.stringify({ newOwnerId, reason }) }),

  myTasks: () => request<{ groups: Record<string, TaskItem[]>; counts: Record<string, number> }>('/api/tasks/my'),
  escalationPool: () => request<any>('/api/tasks/escalation'),
  doneTasks: () => request<any>('/api/tasks/done'),
  dashboard: () => request<Dashboard>('/api/dashboard'),
  notifications: () => request<{ list: Notice[]; unread: number }>('/api/notifications'),
  markAllRead: () => request('/api/notifications/read', { method: 'POST' }),

  templates: () => request<{ templates: Template[] }>('/api/admin/templates'),
  templateDetail: (id: number) => request<TemplateDetail>(`/api/admin/templates/${id}`),
  roles: () => request<{ roles: { code: string; name: string }[] }>('/api/admin/roles'),
  createDraft: () => request<Template>('/api/admin/templates', { method: 'POST', body: JSON.stringify({}) }),
  updateStage: (tplId: number, stageId: number, body: any) =>
    request(`/api/admin/templates/${tplId}/stages/${stageId}`, { method: 'PUT', body: JSON.stringify(body) }),
  publish: (tplId: number) => request(`/api/admin/templates/${tplId}/publish`, { method: 'POST' }),

  orgsTree: () => request<{ orgs: OrgNode[] }>('/api/orgs/tree'),
  users: (q = '') => request<{ users: UserRow[] }>(`/api/users?q=${encodeURIComponent(q)}`),
};
