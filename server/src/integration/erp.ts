import { allRows, getRow, run, tx, scalar } from '../db/index.js';
import { badRequest } from '../common/errors.js';
import { createCaseFromErp } from '../casecore/service.js';
import { jstring } from '../common/util.js';
import type { CurrentUser } from '../auth/index.js';

export interface ErpRow {
  erpArId: string; customerId: string; customerName: string; contractNo?: string; salesOrderNo?: string;
  overdueAmountYuan: number; overdueDays: number; agingBucket: string; orgId: number; ownerId?: number; riskLevel?: string;
}

export function importBatch(rows: ErpRow[], operator: CurrentUser | null): { batchId: number; total: number; success: number; failed: number; errors: { row: number; code: string; msg: string }[] } {
  return tx(() => {
    const batch = run(`insert into erp_import_batch(file_name, row_count, status, operator_id) values(?,?,?,?)`,
      'ERP 导入', rows.length, 'PROCESSING', operator?.id ?? null);
    const batchId = Number(batch.lastInsertRowid);
    let success = 0, failed = 0;
    const errors: { row: number; code: string; msg: string }[] = [];
    rows.forEach((row, i) => {
      run(`insert into erp_import_row(batch_id, row_no, raw_json, status) values(?,?,?,'PENDING')`, batchId, i + 1, jstring(row));
      try {
        if (!row.erpArId || !row.customerId || !row.customerName || !row.overdueAmountYuan || !row.agingBucket || !row.orgId) {
          throw { code: 'ERP_FIELD_MISSING', msg: '缺少必填字段' };
        }
        const dup = getRow<{ id: number }>(`select id from overdue_case where erp_ar_id=?`, row.erpArId);
        if (dup) throw { code: 'ERP_DUPLICATE_AR', msg: `ERP 应收单 ${row.erpArId} 已存在，不允许覆盖` };
        const orgOk = getRow<{ id: number }>(`select id from org_unit where id=?`, row.orgId);
        if (!orgOk) throw { code: 'ORG_NOT_FOUND', msg: `组织 ${row.orgId} 不存在` };
        const { caseId, caseNo } = createCaseFromErp(row, operator?.id ?? null);
        run(`update erp_import_row set status='SUCCESS', case_id=? where batch_id=? and row_no=?`, caseId, batchId, i + 1);
        success++;
      } catch (e: any) {
        failed++;
        const code = e?.code || 'IMPORT_ERROR';
        const msg = e?.msg || e?.message || '未知错误';
        run(`update erp_import_row set status='ERROR', error_code=?, error_msg=? where batch_id=? and row_no=?`, code, msg, batchId, i + 1);
        run(`insert into sync_error(batch_id, row_no, raw_json, error_code, error_msg) values(?,?,?,?,?)`, batchId, i + 1, jstring(row), code, msg);
        errors.push({ row: i + 1, code, msg });
      }
    });
    run(`update erp_import_batch set success_count=?, status=? where id=?`, success, failed > 0 ? 'PARTIAL' : 'SUCCESS', batchId);
    return { batchId, total: rows.length, success, failed, errors };
  });
}

export function listBatches(limit = 10) {
  return allRows<{ id: number; file_name: string; row_count: number; success_count: number; status: string; created_at: string }>(
    `select * from erp_import_batch order by id desc limit ?`, limit
  );
}

export function listSyncErrors(limit = 50) {
  return allRows<{ id: number; batch_id: number; row_no: number; error_code: string; error_msg: string; resolved: number; created_at: string }>(
    `select * from sync_error order by id desc limit ?`, limit
  );
}

export function resolveSyncError(id: number) {
  run(`update sync_error set resolved=1 where id=?`, id);
  return { ok: true };
}

/** OA 审批回调：回写审批号 + 自动补 OA_APPROVAL 凭证 */
export function oaCallback(payload: { processNo: string; status: string; caseNo?: string; type?: string }) {
  if (!payload.processNo) throw badRequest('缺少 processNo');
  const c = payload.caseNo ? getRow<{ id: number; current_stage_id: number | null }>(`select id, current_stage_id from overdue_case where case_no=?`, payload.caseNo) : null;
  run(`insert or replace into approval_ref(case_id, type, process_no, status, source, synced_at) values(?,?,?,?, 'OA', datetime('now'))`,
    c?.id ?? null, payload.type || 'PAYMENT_PLAN', payload.processNo, payload.status);
  if (c?.current_stage_id) {
    run(`insert into evidence(case_id, stage_id, type, name, note, bound) values(?,?,?,?,?,1)`,
      c.id, c.current_stage_id, 'OA_APPROVAL', `OA 审批：${payload.processNo}`, `状态 ${payload.status}`);
  }
  return { ok: true };
}

/** 模拟 ERP 实时同步：外部依赖未配置 → 降级返回，不阻塞页面 */
export function syncFromErpStub() {
  return { ok: false, code: 'ERP_INTERFACE_NOT_CONFIGURED', message: 'ERP 实时接口未配置，已降级；请通过文件导入入账。最近同步时间见台账「ERP 同步时间」。' };
}
