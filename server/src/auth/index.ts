import type { Request, Response, NextFunction } from 'express';
import { db, getRow, run, allRows, tx } from '../db/index.js';
import { RoleCode, ScopeType } from '../common/enums.js';
import { hashPassword, genSalt, uuid, now, parseISO } from '../common/util.js';

export interface CurrentUser {
  id: number;
  name: string;
  employeeNo: string;
  orgId: number;
  orgPath: string;
  orgName: string;
  roles: RoleCode[];
  primaryRole: RoleCode;
  scope: {
    type: ScopeType;
    orgId: number | null;
    orgPath: string | null;
    amountVisible: boolean;
    customerVisible: boolean;
    contractVisible: boolean;
  };
  perms: string[];
}

// 角色 → 功能权限码
const ROLE_PERMS: Record<RoleCode, string[]> = {
  SYS_ADMIN: ['template:read', 'template:edit', 'admin:config'],
  AR_MANAGER: ['case:read', 'case:assign', 'case:advance', 'case:pause', 'case:evidence', 'case:export', 'task:read', 'escalation:read', 'report:read', 'sync:manage', 'sync:read'],
  GROUP_LEADER: ['case:read', 'task:read', 'escalation:read', 'report:read'],
  BU_HEAD: ['case:read', 'case:advance', 'case:pause', 'case:assign', 'task:read', 'escalation:read', 'report:read'],
  DEPT_SUPERVISOR: ['case:read', 'case:advance', 'case:pause', 'case:assign', 'case:evidence', 'task:read', 'escalation:read', 'report:read'],
  SALES: ['case:read', 'case:advance', 'case:evidence', 'case:pause', 'task:read'],
  LEGAL: ['case:read', 'case:advance', 'case:evidence', 'task:read', 'report:read'],
  AUDITOR: ['case:read', 'report:read', 'audit:read']
};

// 角色默认数据域
const ROLE_SCOPE: Record<RoleCode, { type: ScopeType; amountVisible: boolean }> = {
  SYS_ADMIN: { type: ScopeType.NONE, amountVisible: false },
  AR_MANAGER: { type: ScopeType.ALL, amountVisible: true },
  GROUP_LEADER: { type: ScopeType.ALL, amountVisible: true },
  BU_HEAD: { type: ScopeType.ORG_SUBTREE, amountVisible: true },
  DEPT_SUPERVISOR: { type: ScopeType.ORG_SUBTREE, amountVisible: true },
  SALES: { type: ScopeType.SELF, amountVisible: true },
  LEGAL: { type: ScopeType.ASSIGNED, amountVisible: true },
  AUDITOR: { type: ScopeType.ALL, amountVisible: true }
};

export function login(employeeNo: string, password: string): { token: string; user: CurrentUser } | null {
  const u = getRow<{ id: number; name: string; employee_no: string; org_id: number; password_hash: string; salt: string; status: string }>(
    `select * from app_user where employee_no = ?`,
    employeeNo
  );
  if (!u || u.status !== 'ACTIVE') return null;
  if (hashPassword(password, u.salt) !== u.password_hash) return null;
  const user = buildCurrentUser(u.id);
  if (!user) return null;
  const token = uuid();
  const expires = new Date(Date.now() + 8 * 3600 * 1000).toISOString();
  run(`insert into session_store(token, user_id, expires_at) values(?,?,?)`, token, u.id, expires);
  return { token, user };
}

export function buildCurrentUser(userId: number): CurrentUser | null {
  const u = getRow<{ id: number; name: string; employee_no: string; org_id: number; org_path: string; org_name: string }>(
    `select u.id, u.name, u.employee_no, u.org_id, o.path as org_path, o.name as org_name
     from app_user u join org_unit o on o.id = u.org_id where u.id = ?`,
    userId
  );
  if (!u) return null;
  const roleRows = allRows<{ code: string }>(
    `select r.code from user_role ur join role r on r.id = ur.role_id where ur.user_id = ?`,
    userId
  );
  const roles = roleRows.map((r) => r.code as RoleCode);
  const primaryRole = roles[0] || RoleCode.SALES;
  const perms = new Set<string>();
  for (const rc of roles) for (const p of ROLE_PERMS[rc] || []) perms.add(p);
  // 取最强数据域（ALL > ORG_SUBTREE > ASSIGNED > SELF > NONE）
  const order = [ScopeType.ALL, ScopeType.ORG_SUBTREE, ScopeType.ASSIGNED, ScopeType.SELF, ScopeType.TEMP, ScopeType.NONE];
  let scopeType = ScopeType.NONE;
  let amountVisible = false;
  for (const rc of roles) {
    const s = ROLE_SCOPE[rc];
    if (!s) continue;
    if (order.indexOf(s.type) < order.indexOf(scopeType)) scopeType = s.type;
    if (s.amountVisible) amountVisible = true;
  }
  // 临时授权叠加（跨事业部）
  const temp = getRow<{ org_id: number }>(
    `select org_id from temp_grant where grantee_id = ? and expire_at > ? limit 1`,
    userId, now()
  );
  if (temp) {
    scopeType = ScopeType.ORG_SUBTREE;
  }
  // 显式 data_grant 可覆盖字段可见
  const grant = getRow<{ amount_visible: number; customer_visible: number; contract_visible: number }>(
    `select amount_visible, customer_visible, contract_visible from data_grant where subject_id = ? and (expire_at is null or expire_at > ?) order by id desc limit 1`,
    userId, now()
  );
  const scopeOrgId = scopeType === ScopeType.ORG_SUBTREE ? (temp ? temp.org_id : u.org_id) : null;
  const scopeOrgPath = scopeOrgId ? getRow<{ path: string }>(`select path from org_unit where id=?`, scopeOrgId)?.path || null : null;
  return {
    id: u.id,
    name: u.name,
    employeeNo: u.employee_no,
    orgId: u.org_id,
    orgPath: u.org_path,
    orgName: u.org_name,
    roles,
    primaryRole,
    scope: {
      type: scopeType,
      orgId: scopeOrgId,
      orgPath: scopeOrgPath,
      amountVisible: grant ? !!grant.amount_visible : amountVisible,
      customerVisible: grant ? !!grant.customer_visible : true,
      contractVisible: grant ? !!grant.contract_visible : true
    },
    perms: Array.from(perms)
  };
}

export function resolveSession(token: string | undefined): CurrentUser | null {
  if (!token) return null;
  const s = getRow<{ user_id: number; expires_at: string }>(`select user_id, expires_at from session_store where token = ?`, token);
  if (!s) return null;
  if (parseISO(s.expires_at)! < new Date()) {
    run(`delete from session_store where token = ?`, token);
    return null;
  }
  return buildCurrentUser(s.user_id);
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.sid as string | undefined;
  const user = resolveSession(token);
  if (!user) {
    res.status(401).json({ code: 'UNAUTHORIZED', message: '请先登录' });
    return;
  }
  (req as unknown as { user: CurrentUser }).user = user;
  next();
}

export function requirePerm(...perms: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as unknown as { user?: CurrentUser }).user;
    if (!user) return res.status(401).json({ code: 'UNAUTHORIZED', message: '请先登录' });
    for (const p of perms) {
      if (!user.perms.includes(p)) {
        return res.status(403).json({ code: 'FORBIDDEN', message: `无权限：${p}` });
      }
    }
    next();
  };
}

export function logout(token: string | undefined) {
  if (token) run(`delete from session_store where token = ?`, token);
}

export function listDemoAccounts(): { employeeNo: string; name: string; role: string; orgName: string }[] {
  return allRows(`
    select u.employee_no, u.name, group_concat(r.code) as roles, o.name as org_name
    from app_user u
    join user_role ur on ur.user_id = u.id
    join role r on r.id = ur.role_id
    join org_unit o on o.id = u.org_id
    group by u.id
    order by u.id
  `).map((r) => ({
    employeeNo: String(r.employee_no),
    name: String(r.name),
    role: String(r.roles || ''),
    orgName: String(r.org_name)
  }));
}

export { genSalt, hashPassword };
export default db;
