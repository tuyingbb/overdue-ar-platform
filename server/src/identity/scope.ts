import { ScopeType } from '../common/enums.js';
import type { CurrentUser } from '../auth/index.js';
import { getRow } from '../db/index.js';

export interface ScopePredicate {
  sql: string;
  params: unknown[];
}

/** 生成事项列表查询的数据域 WHERE 片段（含前导 AND）。越权返回 404 而不是 403：这里直接裁掉。 */
export function caseScopePredicate(user: CurrentUser, alias = 'c'): ScopePredicate {
  const params: unknown[] = [];
  switch (user.scope.type) {
    case ScopeType.ALL:
      return { sql: '', params };
    case ScopeType.ORG_SUBTREE: {
      const rootPath = user.scope.orgPath;
      if (!rootPath) return { sql: ' AND 1=0', params };
      params.push(rootPath, `${rootPath}/%`);
      return {
        sql: ` AND ${alias}.org_id IN (SELECT id FROM org_unit WHERE path = ? OR path LIKE ?)`,
        params
      };
    }
    case ScopeType.SELF:
      params.push(user.id);
      return { sql: ` AND ${alias}.owner_id = ?`, params };
    case ScopeType.ASSIGNED:
      params.push(user.id);
      return {
        sql: ` AND EXISTS (SELECT 1 FROM case_stage s WHERE s.case_id = ${alias}.id AND s.assignee_id = ? AND s.status = 'ACTIVE')`,
        params
      };
    case ScopeType.TEMP:
    case ScopeType.NONE:
    default:
      return { sql: ' AND 1=0', params };
  }
}

/** 对象级校验：查不到即视为不存在（返回 false，调用方应返回 404） */
export function canAccessCase(user: CurrentUser, caseRow: { owner_id: number | null; org_id: number; id: number } | null): boolean {
  if (!caseRow) return false;
  switch (user.scope.type) {
    case ScopeType.ALL:
      return true;
    case ScopeType.SELF:
      return caseRow.owner_id === user.id;
    case ScopeType.ASSIGNED: {
      const r = getRow<{ n: number }>(
        `select count(*) as n from case_stage where case_id=? and assignee_id=? and status='ACTIVE'`,
        caseRow.id, user.id
      );
      return !!r && r.n > 0;
    }
    case ScopeType.ORG_SUBTREE: {
      const rootPath = user.scope.orgPath;
      if (!rootPath) return false;
      const r = getRow<{ n: number }>(
        `select count(*) as n from org_unit where id=? and (path=? or path like ?)`,
        caseRow.org_id, rootPath, `${rootPath}/%`
      );
      return !!r && r.n > 0;
    }
    default:
      return false;
  }
}

export function loadCaseForUser(user: CurrentUser, caseNo: string) {
  const c = getRow<{
    id: number; owner_id: number; org_id: number; case_no: string;
  }>(`select id, owner_id, org_id, case_no from overdue_case where case_no = ?`, caseNo);
  if (!canAccessCase(user, c)) return null;
  return c;
}

/** 字段脱敏：在 DTO 序列化前把无权字段置空 */
export interface MaskedCase {
  maskedFields: string[];
}
export function applyFieldMask<T>(user: CurrentUser, dto: T): T & MaskedCase {
  const maskedFields: string[] = [];
  const out: Record<string, unknown> = { ...(dto as Record<string, unknown>) };
  if (!user.scope.amountVisible) {
    out.overdueAmount = null;
    out.overdueAmountWan = null;
    out.currency = null;
    maskedFields.push('amount');
  }
  if (!user.scope.customerVisible) {
    out.customerName = '无权查看';
    out.customerId = null;
    maskedFields.push('customer');
  }
  if (!user.scope.contractVisible) {
    out.contractNo = null;
    out.salesOrderNo = null;
    maskedFields.push('contract');
  }
  return { ...(out as T), maskedFields };
}
