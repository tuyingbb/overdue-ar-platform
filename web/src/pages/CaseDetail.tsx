import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type CaseDetail as CaseDetailT, type CompletionCheck, type EvidenceItem, type TimelineEntry, type UserRow } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, Card, DataRow, Empty, Modal, Spinner, StageStepper, toneForRisk, toneForStageStatus, toneForStatus, useToast } from '../components/ui';
import { fmtDate, fmtDateTime, fmtWan, timeAgo, uid } from '../lib/format';
import { ApiError } from '../lib/api';

export default function CaseDetailPage() {
  const { caseNo = '' } = useParams();
  const nav = useNavigate();
  return <CaseDetail key={caseNo} caseNo={caseNo} onBack={() => nav(-1)} />;
}

function CaseDetail({ caseNo, onBack }: { caseNo: string; onBack: () => void }) {
  const { user, can } = useAuth();
  const toast = useToast();
  const [case_, setCase] = useState<CaseDetailT | null>(null);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [cc, setCc] = useState<CompletionCheck | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const [upOpen, setUpOpen] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [reOpen, setReOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const nav = useNavigate();

  /** 拉取详情；出错时向上抛出（404 表示已不在当前用户数据域） */
  const load = useCallback(async (): Promise<void> => {
    setLoading(true); setErr('');
    try {
      const c = await api.getCase(caseNo);
      setCase(c);
      const tl = await api.getTimeline(caseNo);
      setTimeline(Array.isArray(tl) ? tl : (tl?.list || []));
      const ev = await api.getEvidence(caseNo);
      setEvidence(ev.list || []);
      if (c.currentStageId && !['SETTLED', 'LEGAL', 'WRITTEN_OFF'].includes(c.caseStatus)) {
        const check = await api.completionCheck(caseNo, c.currentStageId).catch(() => null);
        setCc(check);
      } else setCc(null);
    } finally { setLoading(false); }
  }, [caseNo]);

  /** 首次进入：捕获错误展示给用户 */
  const loadSafe = useCallback(async () => {
    try { await load(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : '加载失败'); }
  }, [load]);

  useEffect(() => { loadSafe(); }, [loadSafe]);

  const cur = case_?.stages?.find((s) => s.isCurrent);
  const isAssignee = !!cur && cur.assigneeId === user?.id;
  const canAdvance = can('case:advance') && (isAssignee || can('case:assign'));
  const maskedAmount = case_?.maskedFields?.includes('amount');

  /* ===== 上传凭证 ===== */
  const [upStage, setUpStage] = useState<number>(0);
  const [upType, setUpType] = useState('');
  const [upName, setUpName] = useState('');
  const [upNote, setUpNote] = useState('');
  const openUpload = () => {
    if (cur) { setUpStage(cur.id); const missing = cur.requiredEvidence.find((e) => e.required && !e.provided); setUpType(missing?.code || ''); setUpName(missing?.name || ''); setUpNote(''); }
    setUpOpen(true);
  };
  const doUpload = async () => {
    if (!upType || !upName) { toast.push({ type: 'error', msg: '请选择凭证类型并填写名称' }); return; }
    setBusy(true);
    try { await api.uploadEvidence(caseNo, { stageId: upStage, type: upType, name: upName, note: upNote }); toast.push({ type: 'success', msg: '凭证已上传并绑定' }); setUpOpen(false); await load(); }
    catch (e) { toast.push({ type: 'error', msg: e instanceof ApiError ? e.message : '上传失败' }); }
    finally { setBusy(false); }
  };

  /* ===== 完成节点 ===== */
  const [note, setNote] = useState('');
  const [delayReason, setDelayReason] = useState('');
  const needDelay = !!cc?.warnings?.some((w) => w.code === 'DELAY_REASON_REQUIRED' && w.required);
  const doComplete = async () => {
    if (!cc || !cur) return;
    if (needDelay && !delayReason.trim()) { toast.push({ type: 'error', msg: '本节点已超时，请填写延期原因' }); return; }
    setBusy(true);
    try {
      const stageName = cur.name;
      const nextName = cc?.nextStage?.name;
      await api.completeStage(caseNo, cur.id, { version: cc.version, note: note || undefined, delayReason: delayReason || undefined }, uid());
      toast.push({ type: 'success', msg: `已完成「${stageName}」` + (nextName ? `，进入「${nextName}」` : '') });
      setNote(''); setDelayReason('');
      try { await load(); }
      catch (e) {
        if (e instanceof ApiError && e.status === 404) {
          toast.push({ type: 'info', msg: '事项已流转至下一负责人，已不在你的数据域内' });
          nav('/tasks');
        } else { throw e; }
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) { toast.push({ type: 'error', msg: '数据已被他人修改，已刷新，请重试' }); await load(); }
      else toast.push({ type: 'error', msg: e instanceof ApiError ? e.message : '操作失败' });
    } finally { setBusy(false); }
  };

  /* ===== 暂停/恢复 ===== */
  const [pauseReason, setPauseReason] = useState('');
  const doPause = async () => {
    setBusy(true);
    try { await api.pauseCase(caseNo, pauseReason); toast.push({ type: 'success', msg: '已暂停' }); setPauseOpen(false); setPauseReason(''); await load(); }
    catch (e) { toast.push({ type: 'error', msg: e instanceof ApiError ? e.message : '失败' }); } finally { setBusy(false); }
  };
  const doResume = async () => { setBusy(true); try { await api.resumeCase(caseNo); toast.push({ type: 'success', msg: '已恢复' }); await load(); } catch (e) { toast.push({ type: 'error', msg: e instanceof ApiError ? e.message : '失败' }); } finally { setBusy(false); } };

  /* ===== 改派 ===== */
  const [users, setUsers] = useState<UserRow[]>([]);
  const [newOwner, setNewOwner] = useState<number | null>(null);
  const [reReason, setReReason] = useState('');
  const openReassign = () => { setNewOwner(null); setReReason(''); api.users().then((r) => setUsers(r.users)); setReOpen(true); };
  const doReassign = async () => {
    if (!newOwner) { toast.push({ type: 'error', msg: '请选择新负责人' }); return; }
    setBusy(true);
    try { await api.reassignCase(caseNo, newOwner, reReason); toast.push({ type: 'success', msg: '已改派' }); setReOpen(false); await load(); }
    catch (e) { toast.push({ type: 'error', msg: e instanceof ApiError ? e.message : '失败' }); } finally { setBusy(false); }
  };

  if (loading) return <div className="text-center py-20 text-ink-3"><Spinner /> 加载中…</div>;
  if (err || !case_) return <div className="card p-10 text-center"><div className="text-ink-3 mb-3">{err || '事项不存在或无权访问'}</div><button className="btn-ghost" onClick={onBack}>返回</button></div>;

  const terminal = ['SETTLED', 'LEGAL', 'WRITTEN_OFF'].includes(case_.caseStatus);

  return (
    <div className="pb-80 lg:pb-28">
      {/* 头部 */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <button onClick={onBack} className="text-xs text-ink-3 hover:text-accent mb-1">← 返回</button>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-ink font-mono">{case_.caseNo}</h2>
            <Badge tone={toneForStatus(case_.caseStatus)}>{case_.statusLabel}</Badge>
            {case_.isPaused && <Badge tone="amber">已暂停</Badge>}
            {maskedAmount && <Badge tone="gray">金额已脱敏</Badge>}
          </div>
          <div className="text-ink-2 mt-1">{case_.customerName} · {case_.orgName} · 负责人 {case_.ownerName}</div>
        </div>
        <div className="text-right">
          <div className="text-3xl font-bold text-ink">{maskedAmount ? '****' : case_.overdueAmountWan}</div>
          <div className="text-xs text-ink-3">逾期金额 · {case_.currency}</div>
        </div>
      </div>

      {/* 阶段进度 */}
      <Card className="mb-4">
        <StageStepper stages={case_.stages} currentCode={cur?.code} />
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* 左：事实 */}
        <div className="lg:col-span-3 space-y-4">
          <Card>
            <div className="text-sm font-semibold mb-2 flex items-center justify-between">事项事实 <Badge tone="gray">ERP 只读</Badge></div>
            <DataRow label="客户" value={case_.customerName} />
            <DataRow label="客户编号" value={case_.customerId} mono />
            <DataRow label="合同号" value={case_.contractNo || '—'} mono />
            <DataRow label="销售单号" value={case_.salesOrderNo || '—'} mono />
            <DataRow label="逾期金额" value={maskedAmount ? '****（脱敏）' : case_.overdueAmountWan} />
            <DataRow label="逾期天数" value={`${case_.overdueDays} 天`} />
            <DataRow label="账龄" value={case_.agingLabel} />
            <DataRow label="ERP 同步" value={fmtDateTime(case_.erpSyncedAt)} />
          </Card>
          <Card>
            <div className="text-sm font-semibold mb-2">跟进信息</div>
            <DataRow label="原因分类" value={<Badge tone="ink">{case_.reasonLabel}</Badge>} />
            {case_.internalDeptName && <DataRow label="内部整改部门" value={case_.internalDeptName} />}
            <DataRow label="风险等级" value={<Badge tone={toneForRisk(case_.riskLevel)}>{case_.riskLabel}</Badge>} />
            <DataRow label="所属组织" value={case_.orgName} />
            <DataRow label="负责人" value={case_.ownerName} />
            <DataRow label="创建时间" value={fmtDateTime(case_.createdAt)} />
          </Card>
        </div>

        {/* 中：当前节点 + 沟通 */}
        <div className="lg:col-span-6 space-y-4">
          {cur && <CurrentStageCard stage={cur} cc={cc} onUpload={openUpload} />}
          <CommunicationCard caseNo={caseNo} onDone={load} />
          <Card>
            <div className="text-sm font-semibold mb-3">凭证清单（{evidence.length}）</div>
            {evidence.length === 0 ? <Empty text="暂无凭证" /> : (
              <div className="space-y-1.5">
                {evidence.map((e) => (
                  <div key={e.id} className="flex items-center justify-between py-1.5 border-b border-line-soft/60 last:border-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-accent">📎</span>
                      <div className="min-w-0">
                        <div className="text-sm text-ink truncate">{e.name}</div>
                        <div className="text-[11px] text-ink-3">{e.typeLabel} · {e.uploadedBy} · {fmtDateTime(e.uploadedAt)}</div>
                      </div>
                    </div>
                    <Badge tone={e.bound ? 'green' : 'gray'}>{e.bound ? '已绑定' : '未绑定'}</Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* 右：时间轴 */}
        <div className="lg:col-span-3">
          <Card className="h-full">
            <div className="text-sm font-semibold mb-3">时间轴</div>
            <div className="relative pl-4">
              <div className="absolute left-[5px] top-1 bottom-1 w-px bg-line" />
              {timeline.length === 0 ? <Empty text="暂无动态" /> : timeline.slice().reverse().map((t, i) => (
                <div key={i} className="relative pb-3 last:pb-0">
                  <div className={`absolute -left-[11px] top-1 w-2.5 h-2.5 rounded-full ${t.type === 'escalation' ? 'bg-danger' : t.type === 'evidence' ? 'bg-accent' : t.type === 'communication' ? 'bg-blue' : 'bg-ink-3'}`} />
                  <div className="text-[11px] text-ink-3">{timeAgo(t.occurredAt)}</div>
                  <div className="text-sm text-ink">{t.event || t.name || t.type}</div>
                  {t.note && <div className="text-xs text-ink-2 mt-0.5">{t.note}</div>}
                  {t.actor && <div className="text-[10px] text-ink-3">操作人：{t.actor}</div>}
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {/* ===== 底部操作栏 ===== */}
      {!terminal && cur && (
        <div className="fixed bottom-0 left-0 lg:left-56 right-0 bg-surface border-t border-line shadow-[0_-2px_8px_rgba(0,0,0,0.04)] z-30 overflow-x-hidden">
          <div className="px-4 lg:px-6 py-3 flex flex-wrap items-center gap-2 lg:gap-3">
            <div className="w-full lg:flex-1 lg:min-w-0">
              {cc?.blockers?.length ? (
                <div className="space-y-0.5">
                  {cc.blockers.map((b, i) => <div key={i} className="text-xs text-danger">⛔ {b.message}{b.fix ? `（${b.fix}）` : ''}</div>)}
                </div>
              ) : cc?.warnings?.length ? (
                <div className="space-y-0.5">
                  {cc.warnings.map((w, i) => <div key={i} className="text-xs text-warn">⚠ {w.message}</div>)}
                </div>
              ) : (
                <div className="text-xs text-accent">✓ 卡点校验通过，可完成本节点</div>
              )}
              <div className="text-[11px] text-ink-3 mt-0.5">下一节点：{cc?.nextStage?.name || '—'} · {cc?.nextStage?.dueAtRule || ''}</div>
            </div>

            {needDelay && (
              <input className="input w-full sm:w-auto lg:max-w-[180px]" placeholder="延期原因（必填）" value={delayReason} onChange={(e) => setDelayReason(e.target.value)} />
            )}
            <input className="input w-full sm:w-auto lg:max-w-[160px]" placeholder="完成说明（可选）" value={note} onChange={(e) => setNote(e.target.value)} />

            <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto min-w-0">
              {can('case:evidence') && <button className="btn-ghost whitespace-nowrap" onClick={openUpload}>📎 上传凭证</button>}
              {can('case:pause') && (case_.isPaused
                ? <button className="btn-ghost whitespace-nowrap" onClick={doResume} disabled={busy}>恢复</button>
                : <button className="btn-ghost whitespace-nowrap" onClick={() => setPauseOpen(true)} disabled={busy}>暂停</button>)}
              {can('case:assign') && <button className="btn-ghost whitespace-nowrap" onClick={openReassign} disabled={busy}>改派</button>}
              <button className="btn-primary w-full sm:w-auto lg:flex-none whitespace-normal text-center leading-snug" disabled={!canAdvance || !cc?.canComplete || busy} onClick={doComplete}>
                {busy ? <Spinner /> : `完成「${cur.name}」并进入下一节点`}
              </button>
            </div>
            {!canAdvance && <span className="text-[11px] text-ink-3 w-full lg:w-auto">当前节点负责人：{cur.assigneeName || '—'}</span>}
          </div>
        </div>
      )}
      {terminal && (
        <div className="fixed bottom-0 left-0 lg:left-56 right-0 bg-canvas border-t border-line px-4 lg:px-6 py-3 text-center text-sm text-ink-3">
          事项已{case_.statusLabel} · 关闭时间 {fmtDate(case_.closedAt)} · <Link to="/cases" className="text-accent">返回台账</Link>
        </div>
      )}

      {/* 上传凭证 Modal */}
      <Modal open={upOpen} onClose={() => setUpOpen(false)} title="上传凭证（模拟）"
        footer={<><button className="btn-ghost" onClick={() => setUpOpen(false)}>取消</button><button className="btn-primary" onClick={doUpload} disabled={busy}>{busy ? <Spinner /> : '上传'}</button></>}>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-ink-3">绑定节点</label>
            <select className="input mt-1" value={upStage} onChange={(e) => setUpStage(Number(e.target.value))}>
              {case_.stages.map((s) => <option key={s.id} value={s.id}>{s.seq}. {s.name}（{s.status === 'DONE' ? '已完成' : s.status === 'ACTIVE' ? '进行中' : '未开始'}）</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-ink-3">凭证类型</label>
            <select className="input mt-1" value={upType} onChange={(e) => { setUpType(e.target.value); const m = cur?.requiredEvidence.find((x) => x.code === e.target.value); if (m) setUpName(m.name); }}>
              <option value="">— 选择 —</option>
              {cur?.requiredEvidence.map((e) => <option key={e.code} value={e.code}>{e.name}{e.provided ? '（已提供）' : ''}</option>)}
            </select>
          </div>
          <div><label className="text-xs text-ink-3">凭证名称</label><input className="input mt-1" value={upName} onChange={(e) => setUpName(e.target.value)} /></div>
          <div><label className="text-xs text-ink-3">备注</label><textarea className="input mt-1" rows={2} value={upNote} onChange={(e) => setUpNote(e.target.value)} placeholder="如：客户已盖章回传扫描件" /></div>
        </div>
      </Modal>

      {/* 暂停 Modal */}
      <Modal open={pauseOpen} onClose={() => setPauseOpen(false)} title="暂停事项"
        footer={<><button className="btn-ghost" onClick={() => setPauseOpen(false)}>取消</button><button className="btn-primary" onClick={doPause} disabled={busy}>确认暂停</button></>}>
        <label className="text-xs text-ink-3">暂停原因</label>
        <textarea className="input mt-1" rows={3} value={pauseReason} onChange={(e) => setPauseReason(e.target.value)} placeholder="如：客户进入破产重整，等待法院通知" />
      </Modal>

      {/* 改派 Modal */}
      <Modal open={reOpen} onClose={() => setReOpen(false)} title="改派负责人"
        footer={<><button className="btn-ghost" onClick={() => setReOpen(false)}>取消</button><button className="btn-primary" onClick={doReassign} disabled={busy}>确认改派</button></>}>
        <div className="space-y-3">
          <div><label className="text-xs text-ink-3">新负责人</label>
            <select className="input mt-1" value={newOwner ?? ''} onChange={(e) => setNewOwner(Number(e.target.value))}>
              <option value="">— 选择 —</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}（{u.org_name}）</option>)}
            </select>
          </div>
          <div><label className="text-xs text-ink-3">改派原因</label><input className="input mt-1" value={reReason} onChange={(e) => setReReason(e.target.value)} /></div>
        </div>
      </Modal>
    </div>
  );
}

function CurrentStageCard({ stage, cc, onUpload }: { stage: any; cc: CompletionCheck | null; onUpload: () => void }) {
  const overdue = stage.overdueHours > 0;
  return (
    <Card>
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold">当前节点：{stage.name}</span>
            <Badge tone={overdue ? 'red' : 'green'}>{overdue ? `已超时 ${stage.overdueHours}h` : '进行中'}</Badge>
          </div>
          <div className="text-xs text-ink-3 mt-0.5">负责人 {stage.assigneeName || '—'} · SLA 到期 {fmtDateTime(stage.dueAt)}</div>
        </div>
        <Badge tone={toneForStageStatus(stage.status)}>{stage.status}</Badge>
      </div>
      <div className="text-xs text-ink-3 mb-1.5">必传凭证</div>
      <div className="space-y-1.5">
        {stage.requiredEvidence.map((e: any) => (
          <div key={e.code} className="flex items-center justify-between text-sm py-1 px-2 rounded bg-canvas/60">
            <span className={e.provided ? 'text-ink-2 line-through' : 'text-ink'}>
              {e.provided ? '✓' : '○'} {e.name} {e.required ? <span className="text-danger">*</span> : <span className="text-ink-3 text-xs">（选）</span>}
            </span>
            {!e.provided && e.required && <button className="text-xs text-accent hover:underline" onClick={onUpload}>上传</button>}
          </div>
        ))}
      </div>
      {cc?.blockers?.length ? (
        <div className="mt-3 p-2.5 rounded bg-red-50/60 border border-red-100 text-xs text-danger">
          {cc.blockers.map((b, i) => <div key={i}>⛔ {b.message}</div>)}
        </div>
      ) : null}
    </Card>
  );
}

function CommunicationCard({ caseNo, onDone }: { caseNo: string; onDone: () => void }) {
  const toast = useToast();
  const [channel, setChannel] = useState('电话');
  const [contact, setContact] = useState('');
  const [conclusion, setConclusion] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!conclusion.trim()) { toast.push({ type: 'error', msg: '请填写沟通结论' }); return; }
    setBusy(true);
    try { await api.addCommunication(caseNo, { channel, contact: contact || undefined, conclusion }); toast.push({ type: 'success', msg: '沟通记录已保存' }); setConclusion(''); setContact(''); onDone(); }
    catch (e) { toast.push({ type: 'error', msg: e instanceof ApiError ? e.message : '失败' }); } finally { setBusy(false); }
  };
  return (
    <Card>
      <div className="text-sm font-semibold mb-3">记录沟通</div>
      <div className="grid grid-cols-2 gap-2">
        <select className="input" value={channel} onChange={(e) => setChannel(e.target.value)}>
          <option>电话</option><option>微信</option><option>邮件</option><option>上门</option><option>函件</option>
        </select>
        <input className="input" placeholder="对接人（可选）" value={contact} onChange={(e) => setContact(e.target.value)} />
      </div>
      <textarea className="input mt-2" rows={2} placeholder="沟通结论 / 客户承诺" value={conclusion} onChange={(e) => setConclusion(e.target.value)} />
      <div className="text-right mt-2"><button className="btn-ghost" onClick={submit} disabled={busy}>{busy ? <Spinner /> : '保存沟通记录'}</button></div>
    </Card>
  );
}
