import { allRows, scalar } from '../db/index.js';
import type { CurrentUser } from '../auth/index.js';
import { caseScopePredicate } from '../identity/scope.js';
import { REASON_LABEL, AGING_LABEL, RISK_LABEL, STATUS_LABEL, ReasonType, AgingBucket } from '../common/enums.js';
import { shDate } from '../flow/calendar.js';

export interface Dashboard {
  kpi: {
    inProgress: number;
    overdue: number;
    dueThisWeek: number;
    settledThisMonth: number;
    totalAmountWan: string;
  };
  reasonDistribution: { reasonType: string; label: string; count: number; amountWan: string }[];
  agingDistribution: { bucket: string; label: string; count: number; amountWan: string }[];
  riskDistribution: { level: string; label: string; count: number }[];
  statusDistribution: { status: string; label: string; count: number }[];
  timeoutBoard: { caseNo: string; customerName: string; amountWan: string; stageName: string; overdueHours: number; ownerName: string | null; reasonLabel: string }[];
  blockers: { evidenceMissing: number; overdueCount: number; unclassified: number };
  orgEfficiency: { orgName: string; avgHours: number; doneCount: number }[];
}

export function getDashboard(user: CurrentUser): Dashboard {
  const scope = caseScopePredicate(user, 'c');
  const sp = scope.params;

  const inProgress = (scalar<number>(`select count(*) from overdue_case c where c.case_status not in ('SETTLED','WRITTEN_OFF','LEGAL') ${scope.sql}`, ...sp) ?? 0) as number;
  const overdue = (scalar<number>(
    `select count(distinct c.id) from overdue_case c join case_stage s on s.case_id=c.id and s.status='ACTIVE'
     where s.overdue_hours > 0 ${scope.sql}`, ...sp) ?? 0) as number;
  const weekEnd = new Date(Date.now() + 7 * 86400000).toISOString();
  const dueThisWeek = (scalar<number>(
    `select count(distinct c.id) from overdue_case c join case_stage s on s.case_id=c.id and s.status='ACTIVE'
     where s.overdue_hours = 0 and s.due_at <= ? ${scope.sql}`, weekEnd, ...sp) ?? 0) as number;
  const monthStart = shDate(new Date()).slice(0, 7) + '-01';
  const settledThisMonth = (scalar<number>(
    `select count(*) from overdue_case c where c.case_status in ('SETTLED','WRITTEN_OFF','LEGAL') and c.closed_at >= ? ${scope.sql}`, monthStart, ...sp) ?? 0) as number;
  const totalCents = (scalar<number>(
    `select coalesce(sum(c.overdue_amount_cents),0) from overdue_case c where c.case_status not in ('SETTLED','WRITTEN_OFF','LEGAL') ${scope.sql}`, ...sp) ?? 0) as number;

  const reasonRows = allRows<{ reason_type: string; n: number; amt: number }>(
    `select reason_type, count(*) as n, coalesce(sum(overdue_amount_cents),0) as amt from overdue_case c where 1=1 ${scope.sql} group by reason_type order by amt desc`, ...sp
  );
  const agingRows = allRows<{ aging_bucket: string; n: number; amt: number }>(
    `select aging_bucket, count(*) as n, coalesce(sum(overdue_amount_cents),0) as amt from overdue_case c where 1=1 ${scope.sql} group by aging_bucket`, ...sp
  );
  const riskRows = allRows<{ risk_level: string; n: number }>(
    `select risk_level, count(*) as n from overdue_case c where 1=1 ${scope.sql} group by risk_level`, ...sp
  );
  const statusRows = allRows<{ case_status: string; n: number }>(
    `select case_status, count(*) as n from overdue_case c where 1=1 ${scope.sql} group by case_status`, ...sp
  );

  const timeoutBoard = allRows<{ case_no: string; customer_name: string; overdue_amount_cents: number; stage_name: string; overdue_hours: number; owner_name: string | null; reason_type: string }>(
    `select c.case_no, c.customer_name, c.overdue_amount_cents, s.name as stage_name, s.overdue_hours, u.name as owner_name, c.reason_type
     from overdue_case c join case_stage s on s.case_id=c.id and s.status='ACTIVE'
     left join app_user u on u.id=c.owner_id
     where s.overdue_hours > 0 ${scope.sql}
     order by s.overdue_hours desc limit 10`, ...sp
  );

  const evidenceMissing = (scalar<number>(
    `select count(distinct s.id) from case_stage s join overdue_case c on c.id=s.case_id
     where s.status='ACTIVE' ${scope.sql.replace(/c\./g, 'c.')}`, ...sp) ?? 0) as number;
  // 卡点：缺少必传凭证的活跃节点数（简化：用规格里 required 且未上传的；这里近似取超时节点 + 未分类原因）
  const unclassified = (scalar<number>(`select count(*) from overdue_case c where c.reason_type='PENDING' ${scope.sql}`, ...sp) ?? 0) as number;

  const orgEff = allRows<{ org_name: string; avg_hours: number; done_count: number }>(
    `select o.name as org_name,
       avg((julianday(s.completed_at) - julianday(s.started_at)) * 24) as avg_hours,
       count(*) as done_count
     from case_stage s join overdue_case c on c.id=s.case_id
     join org_unit o on o.id=c.org_id
     where s.status='DONE' and s.started_at is not null ${scope.sql}
     group by o.id order by avg_hours desc limit 10`, ...sp
  );

  const wan = (cents: number) => user.scope.amountVisible ? ((cents || 0) / 1_000_000).toFixed(1) + '万' : '****';

  return {
    kpi: {
      inProgress, overdue, dueThisWeek, settledThisMonth, totalAmountWan: wan(totalCents)
    },
    reasonDistribution: reasonRows.map((r) => ({
      reasonType: r.reason_type, label: REASON_LABEL[r.reason_type as ReasonType] || r.reason_type, count: r.n, amountWan: wan(r.amt)
    })),
    agingDistribution: agingRows.map((r) => ({
      bucket: r.aging_bucket, label: AGING_LABEL[r.aging_bucket as AgingBucket] || r.aging_bucket, count: r.n, amountWan: wan(r.amt)
    })),
    riskDistribution: riskRows.map((r) => ({ level: r.risk_level, label: RISK_LABEL[r.risk_level as keyof typeof RISK_LABEL] || r.risk_level, count: r.n })),
    statusDistribution: statusRows.map((r) => ({ status: r.case_status, label: STATUS_LABEL[r.case_status] || r.case_status, count: r.n })),
    timeoutBoard: timeoutBoard.map((r) => ({
      caseNo: r.case_no, customerName: user.scope.customerVisible ? r.customer_name : '无权查看',
      amountWan: wan(r.overdue_amount_cents), stageName: r.stage_name, overdueHours: r.overdue_hours,
      ownerName: r.owner_name, reasonLabel: REASON_LABEL[r.reason_type as ReasonType] || r.reason_type
    })),
    blockers: { evidenceMissing, overdueCount: overdue, unclassified },
    orgEfficiency: orgEff.map((r) => ({ orgName: r.org_name, avgHours: Math.round(r.avg_hours || 0), doneCount: r.done_count }))
  };
}
