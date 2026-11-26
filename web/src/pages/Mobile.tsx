import { useEffect, useState } from 'react';
import { api, type CaseDetail, type TaskItem } from '../lib/api';
import { useToast } from '../components/ui';
import { fmtDateTime } from '../lib/format';
import { ApiError } from '../lib/api';

type Tab = 'todo' | 'evidence' | 'comm';

export default function Mobile() {
  const [tab, setTab] = useState<Tab>('todo');
  return (
    <div className="flex flex-col items-center">
      <div className="text-center mb-4">
        <h2 className="text-lg font-semibold text-ink">移动端 H5</h2>
        <p className="text-xs text-ink-3 mt-0.5">3 屏：待办列表 · 上传凭证 · 记录沟通（与 PC 共用同一套 API）</p>
      </div>
      <div className="device-frame">
        <div className="h-full flex flex-col pt-6">
          <div className="bg-accent text-white px-4 py-3 shrink-0">
            <div className="text-base font-semibold">逾期跟进</div>
            <div className="text-[11px] text-white/80">移动办公 · 随时处理</div>
          </div>
          <div className="flex-1 overflow-y-auto bg-canvas">
            {tab === 'todo' && <TodoScreen />}
            {tab === 'evidence' && <EvidenceScreen />}
            {tab === 'comm' && <CommScreen />}
          </div>
          <div className="grid grid-cols-3 bg-surface border-t border-line shrink-0">
            {([['todo', '📋', '待办'], ['evidence', '📎', '凭证'], ['comm', '💬', '沟通']] as const).map(([k, icon, label]) => (
              <button key={k} onClick={() => setTab(k as Tab)}
                className={`py-2.5 flex flex-col items-center text-[11px] ${tab === k ? 'text-accent' : 'text-ink-3'}`}>
                <span className="text-lg">{icon}</span>{label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function TodoScreen() {
  const [groups, setGroups] = useState<Record<string, TaskItem[]>>({});
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<TaskItem | null>(null);
  useEffect(() => { api.myTasks().then((r) => setGroups(r.groups || {})).finally(() => setLoading(false)); }, []);
  const all = Object.values(groups).flat();
  return (
    <div className="p-3">
      {loading ? <div className="text-center py-10 text-ink-3 text-sm">加载中…</div> :
        all.length === 0 ? <div className="text-center py-10 text-ink-3 text-sm">暂无待办 🎉</div> :
          all.map((t) => (
            <div key={t.caseNo + t.stageId} onClick={() => setSel(t)}
              className="bg-surface rounded-lg p-3 mb-2 border border-line-soft active:bg-canvas">
              <div className="flex items-center justify-between">
                <span className="font-mono text-accent text-xs">{t.caseNo}</span>
                {t.overdueHours > 0 ? <span className="text-[10px] text-danger font-medium">超时 {t.overdueHours}h</span> : <span className="text-[10px] text-ink-3">今日到期</span>}
              </div>
              <div className="text-sm font-medium text-ink mt-0.5 truncate">{t.customerName}</div>
              <div className="flex justify-between text-[11px] text-ink-3 mt-1">
                <span>{t.amountWan} · {t.stageName}</span><span>到期 {fmtDateTime(t.dueAt).slice(5)}</span>
              </div>
              {t.missing?.[0] && <div className="text-[11px] text-warn mt-1">⚠ {t.missing[0]}</div>}
            </div>
          ))}
      {sel && (
        <div className="fixed inset-0 bg-ink/40 z-50 flex items-end" onClick={() => setSel(null)}>
          <div className="w-full bg-surface rounded-t-2xl p-4 max-h-[80%] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-start">
              <div>
                <div className="font-mono text-accent">{sel.caseNo}</div>
                <div className="font-semibold text-ink">{sel.customerName}</div>
              </div>
              <button onClick={() => setSel(null)} className="text-ink-3">✕</button>
            </div>
            <div className="text-xs text-ink-2 mt-2 space-y-1">
              <div>金额：{sel.amountWan}　逾期：{sel.overdueDays} 天</div>
              <div>原因：{sel.reasonLabel}　风险：{sel.riskLevel}</div>
              <div>当前节点：{sel.stageName}　到期：{fmtDateTime(sel.dueAt)}</div>
              {sel.missing?.map((m, i) => <div key={i} className="text-warn">⚠ {m}</div>)}
            </div>
            <a href={`/case/${sel.caseNo}`} target="_blank" rel="noreferrer" className="btn-primary w-full mt-3">在 PC 端打开处理 →</a>
          </div>
        </div>
      )}
    </div>
  );
}

function EvidenceScreen() {
  const toast = useToast();
  const [caseNo, setCaseNo] = useState('OD-202611-0142');
  const [c, setC] = useState<CaseDetail | null>(null);
  const [stageId, setStageId] = useState<number>(0);
  const [type, setType] = useState('');
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (caseNo.length < 6) return;
    try { const d = await api.getCase(caseNo); setC(d); const cur = d.stages.find((s) => s.isCurrent); if (cur) { setStageId(cur.id); const m = cur.requiredEvidence.find((e) => e.required && !e.provided); setType(m?.code || ''); setName(m?.name || ''); } }
    catch (e) { setC(null); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const submit = async () => {
    if (!caseNo || !stageId || !type || !name) { toast.push({ type: 'error', msg: '请填写完整' }); return; }
    setBusy(true);
    try { await api.uploadEvidence(caseNo, { stageId, type, name, note }); toast.push({ type: 'success', msg: '凭证已上传' }); await load(); }
    catch (e) { toast.push({ type: 'error', msg: e instanceof ApiError ? e.message : '失败' }); } finally { setBusy(false); }
  };

  const cur = c?.stages.find((s) => s.id === stageId);
  return (
    <div className="p-3 space-y-3">
      <div>
        <label className="text-xs text-ink-3">案件号</label>
        <div className="flex gap-1.5 mt-1">
          <input className="input flex-1" value={caseNo} onChange={(e) => setCaseNo(e.target.value)} placeholder="OD-..." />
          <button className="btn-ghost" onClick={load}>载入</button>
        </div>
      </div>
      {c && (
        <>
          <div className="bg-surface rounded-lg p-3 border border-line-soft text-xs">
            <div className="font-medium text-ink">{c.customerName}</div>
            <div className="text-ink-3 mt-0.5">{c.overdueAmountWan} · 当前节点：{c.currentStageName}</div>
          </div>
          <div>
            <label className="text-xs text-ink-3">绑定节点</label>
            <select className="input mt-1" value={stageId} onChange={(e) => { const id = Number(e.target.value); setStageId(id); const st = c.stages.find((s) => s.id === id); const m = st?.requiredEvidence.find((e) => e.required && !e.provided); setType(m?.code || ''); setName(m?.name || ''); }}>
              {c.stages.map((s) => <option key={s.id} value={s.id}>{s.seq}. {s.name}（{s.status === 'DONE' ? '已完成' : s.status === 'ACTIVE' ? '进行中' : '未开始'}）</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-ink-3">凭证类型</label>
            <select className="input mt-1" value={type} onChange={(e) => { setType(e.target.value); const m = cur?.requiredEvidence.find((x) => x.code === e.target.value); if (m) setName(m.name); }}>
              <option value="">— 选择 —</option>
              {cur?.requiredEvidence.map((e) => <option key={e.code} value={e.code}>{e.name}{e.provided ? '（已提供）' : ''}</option>)}
            </select>
          </div>
          <div><label className="text-xs text-ink-3">凭证名称</label><input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><label className="text-xs text-ink-3">备注</label><textarea className="input mt-1" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></div>
          <button className="btn-primary w-full" onClick={submit} disabled={busy}>{busy ? '上传中…' : '📎 上传凭证（模拟）'}</button>
        </>
      )}
      {!c && caseNo.length >= 6 && <div className="text-center text-sm text-ink-3 py-6">未找到该案件或无权访问</div>}
    </div>
  );
}

function CommScreen() {
  const toast = useToast();
  const [caseNo, setCaseNo] = useState('');
  const [channel, setChannel] = useState('电话');
  const [conclusion, setConclusion] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!caseNo || !conclusion.trim()) { toast.push({ type: 'error', msg: '请填写案件号与结论' }); return; }
    setBusy(true);
    try { await api.addCommunication(caseNo, { channel, conclusion }); toast.push({ type: 'success', msg: '沟通记录已保存' }); setConclusion(''); }
    catch (e) { toast.push({ type: 'error', msg: e instanceof ApiError ? e.message : '失败' }); } finally { setBusy(false); }
  };
  return (
    <div className="p-3 space-y-3">
      <div><label className="text-xs text-ink-3">案件号</label><input className="input mt-1" value={caseNo} onChange={(e) => setCaseNo(e.target.value)} placeholder="OD-202611-0142" /></div>
      <div>
        <label className="text-xs text-ink-3">沟通方式</label>
        <div className="grid grid-cols-3 gap-1.5 mt-1">
          {['电话', '微信', '邮件', '上门', '函件', '其他'].map((ch) => (
            <button key={ch} onClick={() => setChannel(ch)} className={`py-2 rounded text-xs border ${channel === ch ? 'border-accent bg-accent/10 text-accent font-medium' : 'border-line-soft text-ink-2'}`}>{ch}</button>
          ))}
        </div>
      </div>
      <div><label className="text-xs text-ink-3">沟通结论 / 客户承诺</label><textarea className="input mt-1" rows={4} value={conclusion} onChange={(e) => setConclusion(e.target.value)} placeholder="如：客户承诺下周五前支付 50%，剩余月底结清" /></div>
      <button className="btn-primary w-full" onClick={submit} disabled={busy}>{busy ? '保存中…' : '💾 保存沟通记录'}</button>
      <p className="text-[11px] text-ink-3 text-center mt-2">记录写入 communication_log 与审计日志，PC 端时间轴同步可见</p>
    </div>
  );
}
