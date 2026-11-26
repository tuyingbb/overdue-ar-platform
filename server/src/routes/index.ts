import { Router, type Request, type Response } from 'express';
import { requireAuth, requirePerm, login, logout, resolveSession, buildCurrentUser, listDemoAccounts } from '../auth/index.js';
import type { CurrentUser } from '../auth/index.js';
import { asyncHandler, errorHandler } from '../common/errors.js';
import * as CaseSvc from '../casecore/service.js';
import * as TaskSvc from '../task/service.js';
import * as ReportSvc from '../report/service.js';
import * as FlowAdmin from '../admin/flow.js';
import * as NotifySvc from '../notify/service.js';
import * as Erp from '../integration/erp.js';
import { queryAudit } from '../audit/audit.js';
import { runWorkerCycle } from '../worker/index.js';
import { allRows, getRow } from '../db/index.js';

export const router = Router();

function user(req: Request): CurrentUser {
  return (req as unknown as { user: CurrentUser }).user;
}

// ===== 认证 =====
router.post('/auth/login', asyncHandler(async (req, res) => {
  const { employeeNo, password } = req.body || {};
  const r = login(String(employeeNo || ''), String(password || ''));
  if (!r) return res.status(401).json({ code: 'INVALID_CREDENTIALS', message: '账号或密码错误' });
  res.cookie('sid', r.token, { httpOnly: true, sameSite: 'lax', maxAge: 8 * 3600 * 1000, path: '/' });
  res.json({ user: r.user });
}));
router.post('/auth/logout', (req, res) => { logout(req.cookies?.sid); res.clearCookie('sid'); res.json({ ok: true }); });
router.get('/auth/me', requireAuth, (req, res) => res.json({ user: user(req) }));
router.get('/auth/demo-accounts', (_req, res) => res.json({ accounts: listDemoAccounts() }));

router.use('/api', requireAuth);

// ===== 事项 =====
router.get('/api/cases', (req, res) => {
  const list = CaseSvc.listCases({
    agingBucket: req.query.agingBucket as string, reasonType: req.query.reasonType as string,
    caseStatus: req.query.caseStatus as string, riskLevel: req.query.riskLevel as string,
    orgId: req.query.orgId ? Number(req.query.orgId) : undefined, q: req.query.q as string,
    page: req.query.page ? Number(req.query.page) : 1, pageSize: req.query.pageSize ? Number(req.query.pageSize) : 20
  }, user(req));
  res.json(list);
});
router.get('/api/cases/:caseNo', (req, res) => {
  const c = CaseSvc.getCase(req.params.caseNo, user(req));
  if (!c) return res.status(404).json({ code: 'NOT_FOUND', message: '事项不存在或无权访问' });
  res.json(c);
});
router.get('/api/cases/:caseNo/timeline', (req, res) => {
  const c = CaseSvc.getCase(req.params.caseNo, user(req));
  if (!c) return res.status(404).json({ code: 'NOT_FOUND', message: '事项不存在或无权访问' });
  res.json(CaseSvc.getTimeline(req.params.caseNo, user(req)));
});
router.get('/api/cases/:caseNo/evidence', (req, res) => {
  const c = CaseSvc.getCase(req.params.caseNo, user(req));
  if (!c) return res.status(404).json({ code: 'NOT_FOUND', message: '事项不存在或无权访问' });
  res.json(CaseSvc.listEvidence(req.params.caseNo, user(req)));
});
router.get('/api/cases/:caseNo/completion-check', (req, res) => {
  const stageId = Number(req.query.stageId);
  if (!stageId) return res.status(400).json({ code: 'BAD_REQUEST', message: '缺少 stageId' });
  res.json(CaseSvc.getCompletionCheck(req.params.caseNo, stageId, user(req)));
});
router.post('/api/cases/:caseNo/stages/:stageId/complete', (req, res) => {
  const result = CaseSvc.completeStage(req.params.caseNo, Number(req.params.stageId), req.body || {}, user(req), req.header('Idempotency-Key'), req.ip);
  res.json(result);
});
router.post('/api/cases/:caseNo/pause', (req, res) => {
  res.json(CaseSvc.pauseCase(req.params.caseNo, String(req.body?.reason || ''), user(req)));
});
router.post('/api/cases/:caseNo/resume', (_req, res) => {
  res.json(CaseSvc.resumeCase((_req as any).params.caseNo, user(_req)));
});
router.post('/api/cases/:caseNo/reassign', (req, res) => {
  res.json(CaseSvc.reassignCase(req.params.caseNo, Number(req.body?.newOwnerId), String(req.body?.reason || ''), user(req)));
});
router.post('/api/cases/:caseNo/evidence', (req, res) => {
  res.json(CaseSvc.uploadEvidence(req.params.caseNo, req.body || {}, user(req)));
});
router.post('/api/cases/:caseNo/communication', (req, res) => {
  res.json(CaseSvc.addCommunication(req.params.caseNo, req.body || {}, user(req)));
});

// ===== 任务 =====
router.get('/api/tasks/my', (_req, res) => res.json(TaskSvc.myTasks(user(_req))));
router.get('/api/tasks/escalation', (_req, res) => res.json(TaskSvc.escalationPool(user(_req))));
router.get('/api/tasks/done', (_req, res) => res.json(TaskSvc.doneTasks(user(_req))));

// ===== 看板 =====
router.get('/api/dashboard', (_req, res) => res.json(ReportSvc.getDashboard(user(_req))));

// ===== 通知 =====
router.get('/api/notifications', (_req, res) => res.json(NotifySvc.listNotifications(user(_req).id)));
router.post('/api/notifications/read', (_req, res) => res.json(NotifySvc.markRead(user(_req).id)));
router.post('/api/notifications/:id/read', (req, res) => res.json(NotifySvc.markRead(user(req).id, Number(req.params.id))));

// ===== 流程模板配置 =====
router.get('/api/admin/templates', (_req, res) => res.json({ templates: FlowAdmin.listTemplates() }));
router.get('/api/admin/templates/:id', (req, res) => {
  const t = FlowAdmin.getTemplateDetail(Number(req.params.id));
  if (!t) return res.status(404).json({ code: 'NOT_FOUND', message: '模板不存在' });
  res.json(t);
});
router.get('/api/admin/roles', (_req, res) => res.json({ roles: FlowAdmin.listRoles() }));
router.post('/api/admin/templates', requirePerm('admin:config'), (req, res) => {
  res.json(FlowAdmin.createDraft(String(req.body?.code || 'TPL-AR-STD'), String(req.body?.name || '应收账款逾期跟进流程'), user(req).id));
});
router.put('/api/admin/templates/:id/stages/:stageId', requirePerm('admin:config'), (req, res) => {
  res.json(FlowAdmin.updateStage(Number(req.params.id), Number(req.params.stageId), req.body || {}));
});
router.post('/api/admin/templates/:id/publish', requirePerm('admin:config'), (req, res) => {
  res.json(FlowAdmin.publish(Number(req.params.id), user(req)));
});

// ===== 集成 =====
router.post('/api/integrations/erp/import', requirePerm('sync:manage'), (req, res) => {
  res.json(Erp.importBatch(req.body?.rows || [], user(req)));
});
router.get('/api/integrations/erp/batches', (_req, res) => res.json({ batches: Erp.listBatches() }));
router.get('/api/integrations/erp/errors', (_req, res) => res.json({ errors: Erp.listSyncErrors() }));
router.post('/api/integrations/erp/errors/:id/resolve', requirePerm('sync:manage'), (req, res) => res.json(Erp.resolveSyncError(Number(req.params.id))));
router.post('/api/integrations/erp/sync', requirePerm('sync:read'), (_req, res) => res.json(Erp.syncFromErpStub()));
router.post('/api/integrations/oa/callback', (req, res) => res.json(Erp.oaCallback(req.body || {})));

// ===== 审计 / 组织 / 用户 / 运维 =====
router.get('/api/audit', (req, res) => {
  const objectType = String(req.query.objectType || 'case');
  const objectId = String(req.query.objectId || '');
  res.json({ entries: queryAudit(objectType, objectId) });
});
router.get('/api/orgs/tree', (req, res) => {
  const u = user(req);
  const rows = allRows<{ id: number; parent_id: number | null; name: string; path: string; level: number }>(`select id, parent_id, name, path, level from org_unit order by level, id`);
  // 按域裁剪
  const visible = rows.filter((o) => {
    if (u.scope.type === 'ALL') return true;
    if (u.scope.type === 'ORG_SUBTREE' && u.scope.orgPath) return o.path === u.scope.orgPath || o.path.startsWith(u.scope.orgPath + '/');
    return o.id === u.orgId;
  });
  res.json({ orgs: visible });
});
router.get('/api/users', (req, res) => {
  const q = String(req.query.q || '');
  const rows = allRows<{ id: number; name: string; employee_no: string; org_name: string }>(
    `select u.id, u.name, u.employee_no, o.name as org_name from app_user u join org_unit o on o.id=u.org_id
     where u.status='ACTIVE' and (u.name like ? or u.employee_no like ?) order by u.id limit 30`, `%${q}%`, `%${q}%`
  );
  res.json({ users: rows });
});
router.post('/api/admin/worker/run', requirePerm('admin:config'), (_req, res) => res.json(runWorkerCycle()));

router.use(errorHandler);

export default router;
