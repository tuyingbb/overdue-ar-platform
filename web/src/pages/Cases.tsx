import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type CaseRow } from '../lib/api';
import { Badge, Card, Empty, Spinner, toneForRisk, toneForStatus, useMount } from '../components/ui';

const AGING_OPTS = [
  { v: '', l: '全部账龄' }, { v: 'LT1Y', l: '1 年以内' }, { v: 'Y1_2', l: '1–2 年' },
  { v: 'Y2_3', l: '2–3 年' }, { v: 'GT3Y', l: '3 年以上' },
];
const REASON_OPTS = [
  { v: '', l: '全部原因' }, { v: 'CUSTOMER_CASH', l: '客户资金' }, { v: 'CHANNEL', l: '渠道压货' },
  { v: 'INTERNAL_DOC', l: '我方单据' }, { v: 'DISPUTE', l: '商务争议' }, { v: 'RELATED_PARTY', l: '关联方' }, { v: 'PENDING', l: '待核实' },
];
const RISK_OPTS = [
  { v: '', l: '全部风险' }, { v: 'CRITICAL', l: '极高' }, { v: 'HIGH', l: '高' }, { v: 'MEDIUM', l: '中' }, { v: 'LOW', l: '低' },
];
const STATUS_OPTS = [
  { v: '', l: '全部状态' }, { v: 'PENDING_ASSIGN', l: '待分派' }, { v: 'REASON_CHECK', l: '原因核实' },
  { v: 'INTERNAL_RECTIFY', l: '内部整改' }, { v: 'IN_PROGRESS', l: '跟进中' }, { v: 'PLAN_PENDING', l: '方案待审' },
  { v: 'EXECUTING', l: '执行中' }, { v: 'SETTLED', l: '已结清' }, { v: 'LEGAL', l: '已移交法务' }, { v: 'WRITTEN_OFF', l: '已核销' },
];

export default function Cases() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [aging, setAging] = useState('');
  const [reason, setReason] = useState('');
  const [risk, setRisk] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);

  const [data, setData] = useState<{ list: CaseRow[]; total: number } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.listCases({ q, agingBucket: aging, reasonType: reason, riskLevel: risk, caseStatus: status, page, pageSize })
      .then((r) => setData(r)).finally(() => setLoading(false));
  }, [q, aging, reason, risk, status, page, pageSize]);

  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const amountVisible = data?.list?.[0]?.maskedFields ? !data.list[0].maskedFields.includes('amount') : true;

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <KpiStrip />

      <Card>
        <div className="flex flex-wrap gap-2 mb-4">
          <input className="input max-w-[220px]" placeholder="搜索案件号 / 客户 / 合同" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          <select className="input max-w-[150px]" value={aging} onChange={(e) => { setAging(e.target.value); setPage(1); }}>
            {AGING_OPTS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
          <select className="input max-w-[150px]" value={reason} onChange={(e) => { setReason(e.target.value); setPage(1); }}>
            {REASON_OPTS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
          <select className="input max-w-[130px]" value={risk} onChange={(e) => { setRisk(e.target.value); setPage(1); }}>
            {RISK_OPTS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
          <select className="input max-w-[140px]" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            {STATUS_OPTS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
          <div className="ml-auto text-xs text-ink-3 self-center">共 {total} 条</div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-3 border-b border-line-soft text-xs">
                <th className="py-2.5 px-2 font-medium">案件号</th>
                <th className="py-2.5 px-2 font-medium">客户</th>
                <th className="py-2.5 px-2 font-medium text-right">{amountVisible ? '逾期金额' : '金额'}</th>
                <th className="py-2.5 px-2 font-medium">账龄</th>
                <th className="py-2.5 px-2 font-medium">原因</th>
                <th className="py-2.5 px-2 font-medium">风险</th>
                <th className="py-2.5 px-2 font-medium">当前节点</th>
                <th className="py-2.5 px-2 font-medium">状态</th>
                <th className="py-2.5 px-2 font-medium">负责人</th>
                <th className="py-2.5 px-2 font-medium text-right">逾期</th>
              </tr>
            </thead>
            <tbody>
              {loading ? <tr><td colSpan={10} className="text-center py-10 text-ink-3"><Spinner /> 加载中…</td></tr> :
                !data?.list?.length ? <tr><td colSpan={10}><Empty text="无符合条件的事项" /></td></tr> :
                  data.list.map((c) => (
                    <tr key={c.id} className="border-b border-line-soft/60 hover:bg-canvas/50 cursor-pointer" onClick={() => nav(`/case/${c.caseNo}`)}>
                      <td className="py-2.5 px-2 font-mono text-accent">{c.caseNo}{c.isPaused && <Badge tone="amber">暂停</Badge>}</td>
                      <td className="py-2.5 px-2 text-ink">{c.customerName}</td>
                      <td className="py-2.5 px-2 text-right font-medium">{amountVisible ? c.overdueAmountWan : '****'}</td>
                      <td className="py-2.5 px-2 text-ink-2">{c.agingLabel}</td>
                      <td className="py-2.5 px-2"><Badge tone="ink">{c.reasonLabel}</Badge></td>
                      <td className="py-2.5 px-2"><Badge tone={toneForRisk(c.riskLevel)}>{c.riskLabel}</Badge></td>
                      <td className="py-2.5 px-2 text-ink-2">{c.currentStageName}</td>
                      <td className="py-2.5 px-2"><Badge tone={toneForStatus(c.caseStatus)}>{c.statusLabel}</Badge></td>
                      <td className="py-2.5 px-2 text-ink-2">{c.ownerName}</td>
                      <td className="py-2.5 px-2 text-right">
                        {c.overdueHours > 0 ? <span className="text-danger font-medium">{c.overdueHours}h</span> : <span className="text-ink-3">—</span>}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between mt-4">
          <div className="text-xs text-ink-3">第 {page} / {totalPages} 页</div>
          <div className="flex gap-2">
            <button className="btn-ghost" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>上一页</button>
            <button className="btn-ghost" disabled={page >= totalPages || loading} onClick={() => setPage((p) => p + 1)}>下一页</button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function KpiStrip() {
  const [d] = useMount(() => api.dashboard(), []);
  const k = d?.kpi;
  const items = [
    { l: '在途事项', v: k?.inProgress, t: 'accent' },
    { l: '已超时', v: k?.overdue, t: 'red' },
    { l: '本周到期', v: k?.dueThisWeek, t: 'amber' },
    { l: '本月结清', v: k?.settledThisMonth, t: 'green' },
    { l: '在途总金额', v: k?.totalAmountWan, t: 'ink' },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {items.map((it) => (
        <Card key={it.l} className="py-3">
          <div className="text-xs text-ink-3">{it.l}</div>
          <div className={`text-2xl font-bold mt-1 ${it.t === 'red' ? 'text-danger' : it.t === 'amber' ? 'text-warn' : it.t === 'green' ? 'text-accent' : 'text-ink'}`}>
            {it.v ?? <Spinner />}
          </div>
        </Card>
      ))}
      <Link to="/dashboard" className="col-span-2 md:col-span-5 text-xs text-accent text-right hover:underline">查看完整看板 →</Link>
    </div>
  );
}
