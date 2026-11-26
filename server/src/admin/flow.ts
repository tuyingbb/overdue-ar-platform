import { allRows, getRow, run, tx, scalar } from '../db/index.js';
import { badRequest, validationError } from '../common/errors.js';
import { RoleCode, SlaUnit, EvidenceType } from '../common/enums.js';
import { jstring, jparse, now } from '../common/util.js';
import type { CurrentUser } from '../auth/index.js';
import { parseStageSpec, type StageSpec } from '../flow/engine.js';

export interface StageView {
  id: number; code: string; seq: number; name: string; ownerRole: string;
  slaValue: number; slaUnit: string; evidence: unknown; escalation: unknown; next: unknown;
  blockNext: boolean; isTerminal: boolean;
}

export function listTemplates() {
  return allRows<{ id: number; code: string; name: string; version: number; status: string; published_at: string | null; created_at: string }>(
    `select id, code, name, version, status, published_at, created_at from flow_template order by code, version desc`
  );
}

export function getTemplateDetail(id: number) {
  const t = getRow<{ id: number; code: string; name: string; version: number; status: string; published_at: string | null; published_by: number | null; remark: string | null }>(
    `select id, code, name, version, status, published_at, published_by, remark from flow_template where id=?`, id
  );
  if (!t) return null;
  const rows = allRows<{ id: number; code: string; seq: number; name: string; owner_role: string; sla_value: number; sla_unit: string; evidence_json: string; escalation_json: string; next_json: string; block_next: number; is_terminal: number }>(
    `select * from stage_def where template_id=? order by seq asc`, id
  );
  const stages: StageView[] = rows.map((r) => {
    const s = parseStageSpec(r);
    return {
      id: r.id, code: r.code, seq: r.seq, name: r.name, ownerRole: s.ownerRole,
      slaValue: s.slaValue, slaUnit: s.slaUnit, evidence: s.evidence, escalation: s.escalation,
      next: s.next, blockNext: s.blockNext, isTerminal: s.isTerminal
    };
  });
  return { ...t, stages };
}

export function listRoles() {
  return allRows<{ code: string; name: string; scope_type: string }>(`select code, name, scope_type from role order by id`);
}

export function createDraft(code: string, name: string, actorId: number) {
  return tx(() => {
    const maxV = (scalar<number>(`select max(version) from flow_template where code=?`, code) ?? 0) as number;
    const r = run(`insert into flow_template(code,name,version,status,created_by) values(?,?,?,'DRAFT',?)`, code, name, maxV + 1, actorId);
    const id = Number(r.lastInsertRowid);
    // 从最新已发布版本复制节点
    const pub = getRow<{ id: number }>(`select id from flow_template where code=? and status='PUBLISHED' order by version desc limit 1`, code);
    if (pub) {
      const stages = allRows<{ code: string; seq: number; name: string; owner_role: string; sla_value: number; sla_unit: string; evidence_json: string; escalation_json: string; next_json: string; block_next: number; is_terminal: number }>(
        `select * from stage_def where template_id=?`, pub.id
      );
      for (const s of stages) {
        run(`insert into stage_def(template_id,code,seq,name,owner_role,sla_value,sla_unit,evidence_json,escalation_json,next_json,block_next,is_terminal)
             values(?,?,?,?,?,?,?,?,?,?,?,?)`,
          id, s.code, s.seq, s.name, s.owner_role, s.sla_value, s.sla_unit, s.evidence_json, s.escalation_json, s.next_json, s.block_next, s.is_terminal);
      }
    }
    return { id, version: maxV + 1 };
  });
}

export function updateStage(templateId: number, stageId: number, patch: Partial<StageSpec> & { name?: string }) {
  const cur = getRow<{ template_id: number }>(`select template_id from stage_def where id=?`, stageId);
  if (!cur || cur.template_id !== templateId) throw badRequest('节点不存在');
  const tpl = getRow<{ status: string }>(`select status from flow_template where id=?`, templateId);
  if (!tpl || tpl.status !== 'DRAFT') throw badRequest('只能编辑草稿版本');
  const curRow = getRow<any>(`select * from stage_def where id=?`, stageId);
  const spec = parseStageSpec(curRow);
  const merged: StageSpec = { ...spec, ...patch };
  run(`update stage_def set name=?, owner_role=?, sla_value=?, sla_unit=?, evidence_json=?, escalation_json=?, next_json=?, block_next=?, is_terminal=? where id=?`,
    merged.name, merged.ownerRole, merged.slaValue, merged.slaUnit,
    jstring(merged.evidence), jstring(merged.escalation), jstring(merged.next),
    merged.blockNext ? 1 : 0, merged.isTerminal ? 1 : 0, stageId);
  return { ok: true };
}

const VALID_EVIDENCE = new Set(Object.values(EvidenceType));
const VALID_TARGETS = new Set(['ASSIGNEE', 'ASSIGNEE_SUPERVISOR', 'ESCALATION_POOL', 'LEGAL']);

export interface PublishError { field: string; message: string; }
export function publish(templateId: number, actor: CurrentUser): { ok: true } {
  return tx(() => {
    const tpl = getRow<{ id: number; code: string; status: string }>(`select * from flow_template where id=?`, templateId);
    if (!tpl) throw badRequest('模板不存在');
    if (tpl.status === 'PUBLISHED') throw badRequest('该版本已发布');
    const rows = allRows<any>(`select * from stage_def where template_id=? order by seq asc`, templateId);
    const errors: PublishError[] = [];
    // 1. 至少一个节点
    if (rows.length === 0) errors.push({ field: 'stages', message: '流程至少需要一个节点' });
    // 2. 节点名称唯一
    const nameSet = new Set<string>();
    for (const r of rows) { if (nameSet.has(r.name)) errors.push({ field: `stage.${r.code}.name`, message: `节点名称重复：${r.name}` }); nameSet.add(r.name); }
    // 3. seq 连续从 1 开始
    rows.forEach((r, i) => { if (r.seq !== i + 1) errors.push({ field: `stage.${r.code}.seq`, message: '节点序号必须从 1 连续递增' }); });
    // 4. owner_role + sla 合法
    for (const r of rows) {
      if (!Object.values(RoleCode).includes(r.owner_role)) errors.push({ field: `stage.${r.code}.ownerRole`, message: '责任人角色不合法' });
      if (!Object.values(SlaUnit).includes(r.sla_unit)) errors.push({ field: `stage.${r.code}.slaUnit`, message: '时限单位不合法' });
      if (r.sla_value < 0) errors.push({ field: `stage.${r.code}.slaValue`, message: '时限不能为负' });
    }
    // 5. 证据类型合法
    for (const r of rows) {
      const evs = jparse<{ code: string }[]>(r.evidence_json, []);
      for (const e of evs) if (!VALID_EVIDENCE.has(e.code as EvidenceType)) errors.push({ field: `stage.${r.code}.evidence`, message: `证据类型不合法：${e.code}` });
    }
    // 6. 升级 target 合法 + threshold 递增
    for (const r of rows) {
      const esc = jparse<{ level: number; thresholdWorkdays: number; target: string }[]>(r.escalation_json, []);
      let prev = 0;
      for (const e of esc) {
        if (!VALID_TARGETS.has(e.target)) errors.push({ field: `stage.${r.code}.escalation`, message: `升级对象不合法：${e.target}` });
        if (e.thresholdWorkdays <= prev) errors.push({ field: `stage.${r.code}.escalation`, message: '升级阈值必须逐级递增' });
        prev = e.thresholdWorkdays;
      }
    }
    // 7. 下一节点引用存在
    const codes = new Set(rows.map((r) => r.code));
    for (const r of rows) {
      const next = jparse<{ default?: string; routing?: Record<string, string> }>(r.next_json, {});
      if (next.default && !codes.has(next.default)) errors.push({ field: `stage.${r.code}.next`, message: `下一节点不存在：${next.default}` });
      if (next.routing) for (const v of Object.values(next.routing)) if (v && !codes.has(v)) errors.push({ field: `stage.${r.code}.next`, message: `路由下一节点不存在：${v}` });
    }
    // 8. 存在终态出口（最后一个节点无 next，或存在 terminal 节点）
    const hasTerminal = rows.some((r) => r.is_terminal) || rows.every((r) => {
      const n = jparse<{ default?: string }>(r.next_json, {});
      return !!n.default || r.seq === rows.length;
    });
    if (!hasTerminal) errors.push({ field: 'flow', message: '流程缺少终态出口' });

    if (errors.length > 0) throw validationError(errors as any);

    run(`update flow_template set status='PUBLISHED', published_by=?, published_at=datetime('now') where id=?`, actor.id, templateId);
    return { ok: true as const };
  });
}

export { now };
