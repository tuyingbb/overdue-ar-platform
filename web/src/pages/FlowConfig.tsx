import { useEffect, useState } from 'react';
import { api, type Template, type TemplateDetail, type StageSpec } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, Card, Empty, Modal, Spinner, useToast } from '../components/ui';
import { ApiError } from '../lib/api';

const SLA_UNITS = [
  { v: 'HOUR', l: '小时' }, { v: 'WORKDAY', l: '工作日' }, { v: 'NATURAL', l: '自然日' },
];

export default function FlowConfig() {
  const { can } = useAuth();
  const toast = useToast();
  const [tpls, setTpls] = useState<Template[]>([]);
  const [sel, setSel] = useState<number | null>(null);
  const [detail, setDetail] = useState<TemplateDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [roles, setRoles] = useState<{ code: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [pubMsg, setPubMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => { api.templates().then((r) => { setTpls(r.templates); if (r.templates.length) setSel(r.templates[0].id); }); api.roles().then((r) => setRoles(r.roles)).catch(() => {}); }, []);
  useEffect(() => { if (sel) { setLoading(true); api.templateDetail(sel).then((d) => { setDetail(d); setPubMsg(null); }).finally(() => setLoading(false)); } }, [sel]);

  const createDraft = async () => {
    setBusy(true);
    try { const t = await api.createDraft(); toast.push({ type: 'success', msg: `已创建草稿 v${t.version}` }); const r = await api.templates(); setTpls(r.templates); setSel(t.id); }
    catch (e) { toast.push({ type: 'error', msg: e instanceof ApiError ? e.message : '失败' }); } finally { setBusy(false); }
  };

  const saveStage = async (st: StageSpec, patch: any) => {
    if (!detail) return;
    setBusy(true);
    try { await api.updateStage(detail.id, st.id!, patch); toast.push({ type: 'success', msg: `已保存「${st.name}」` }); const d = await api.templateDetail(detail.id); setDetail(d); }
    catch (e) { toast.push({ type: 'error', msg: e instanceof ApiError ? e.message : '保存失败' }); } finally { setBusy(false); }
  };

  const publish = async () => {
    if (!detail) return;
    setBusy(true); setPubMsg(null);
    try { await api.publish(detail.id); setPubMsg({ ok: true, text: `v${detail.version} 已发布，新事项将按此版本实例化` }); const r = await api.templates(); setTpls(r.templates); const d = await api.templateDetail(detail.id); setDetail(d); }
    catch (e) { setPubMsg({ ok: false, text: e instanceof ApiError ? e.message : '发布失败' }); }
    finally { setBusy(false); }
  };

  const isDraft = detail?.status === 'DRAFT';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
      {/* 模板版本列表 */}
      <div className="lg:col-span-3">
        <Card className="h-full">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold">流程模板</div>
            {can('admin:config') && <button className="btn-primary !py-1 !px-2 text-xs" onClick={createDraft} disabled={busy}>+ 新建草稿</button>}
          </div>
          <div className="space-y-1.5">
            {tpls.map((t) => (
              <div key={t.id} onClick={() => setSel(t.id)}
                className={`p-2.5 rounded-md border cursor-pointer transition-colors ${sel === t.id ? 'border-accent bg-accent/5' : 'border-line-soft hover:bg-canvas/50'}`}>
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm text-ink">{t.code}</span>
                  <Badge tone={t.status === 'PUBLISHED' ? 'green' : 'amber'}>{t.status === 'PUBLISHED' ? '已发布' : '草稿'}</Badge>
                </div>
                <div className="text-xs text-ink-3 mt-0.5">v{t.version} · {t.name}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* 详情 */}
      <div className="lg:col-span-9">
        <Card>
          {loading ? <div className="text-center py-12 text-ink-3"><Spinner /></div> : !detail ? <Empty text="选择左侧模板" /> : (
            <>
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-base font-semibold">{detail.name} <span className="text-ink-3 font-normal">v{detail.version}</span></h3>
                  <p className="text-xs text-ink-3 mt-0.5">{detail.stages.length} 个节点 · 状态 {detail.status === 'PUBLISHED' ? '已发布（现行）' : '草稿（编辑中）'} · {detail.published_at ? `发布于 ${detail.published_at}` : '未发布'}</p>
                </div>
                {can('admin:config') && isDraft && <button className="btn-primary" onClick={publish} disabled={busy}>{busy ? <Spinner /> : '发布此版本'}</button>}
              </div>

              {pubMsg && (
                <div className={`mb-3 p-2.5 rounded text-sm border ${pubMsg.ok ? 'bg-green-50 text-accent border-green-200' : 'bg-red-50 text-danger border-red-200'}`}>
                  {pubMsg.ok ? '✓ ' : '⛔ '}{pubMsg.text}
                </div>
              )}
              {!pubMsg && isDraft && (
                <div className="mb-3 p-2.5 rounded bg-amber-50 text-warn border border-amber-200 text-xs">
                  发布前将执行 8 项校验：节点数≥1 / 名称唯一 / 序号连续 / 角色与 SLA 合法 / 必传凭证配置 / 升级目标与阈值递增 / next 引用存在 / 终态出口正确。
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-ink-3 text-xs border-b border-line-soft">
                    <th className="py-2 px-2 font-medium">序</th><th className="py-2 px-2 font-medium">编码 / 名称</th>
                    <th className="py-2 px-2 font-medium">负责角色</th><th className="py-2 px-2 font-medium">SLA</th>
                    <th className="py-2 px-2 font-medium">必传凭证</th><th className="py-2 px-2 font-medium">升级</th><th className="py-2 px-2 font-medium">下一节点</th>
                  </tr></thead>
                  <tbody>
                    {detail.stages.slice().sort((a, b) => a.seq - b.seq).map((s) => (
                      <tr key={s.id} className="border-b border-line-soft/60 align-top">
                        <td className="py-2 px-2 font-mono">{s.seq}{s.isTerminal && <Badge tone="gray">终</Badge>}</td>
                        <td className="py-2 px-2"><div className="font-medium text-ink">{s.name}</div><div className="text-[11px] text-ink-3 font-mono">{s.code}</div></td>
                        <td className="py-2 px-2">
                          {isDraft ? (
                            <select className="input !py-1 !text-xs" value={s.ownerRole} onChange={(e) => saveStage(s, { ownerRole: e.target.value })}>
                              {roles.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
                            </select>
                          ) : <span className="text-ink-2">{roles.find((r) => r.code === s.ownerRole)?.name || s.ownerRole}</span>}
                        </td>
                        <td className="py-2 px-2">
                          {isDraft ? (
                            <div className="flex items-center gap-1">
                              <input type="number" min={0} className="input !py-1 !text-xs w-16" value={s.slaValue}
                                onChange={(e) => saveStage(s, { slaValue: Number(e.target.value) })} />
                              <select className="input !py-1 !text-xs" value={s.slaUnit} onChange={(e) => saveStage(s, { slaUnit: e.target.value })}>
                                {SLA_UNITS.map((u) => <option key={u.v} value={u.v}>{u.l}</option>)}
                              </select>
                            </div>
                          ) : <span className="text-ink-2">{s.slaValue} {SLA_UNITS.find((u) => u.v === s.slaUnit)?.l}</span>}
                        </td>
                        <td className="py-2 px-2 text-ink-2 text-xs">{s.evidence.length ? s.evidence.map((e: any) => e.name).join('、') : '—'}</td>
                        <td className="py-2 px-2 text-ink-2 text-xs">{s.escalation.length ? `${s.escalation.length} 级` : '—'}</td>
                        <td className="py-2 px-2 text-ink-2 text-xs font-mono">{s.next?.default || (s.next?.routing ? Object.entries(s.next.routing).map(([k, v]) => `${k}→${v}`).join(' ') : '终态')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-ink-3 mt-3">💡 草稿状态可直接改单元格；已发布版本只读。修改后点击「发布此版本」触发校验。</p>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
