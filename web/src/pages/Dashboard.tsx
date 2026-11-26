import { api, type Dashboard as Dash } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, Card, Empty, Spinner, useMount } from '../components/ui';
import { useNavigate } from 'react-router-dom';

export default function Dashboard() {
  const [d, loading] = useMount<Dash>(() => api.dashboard(), []);
  if (loading) return <div className="text-center py-20 text-ink-3"><Spinner /> 加载中…</div>;
  if (!d) return <Card><Empty text="暂无看板数据" /></Card>;
  const k = d.kpi;
  const maxReason = Math.max(1, ...d.reasonDistribution.map((x) => x.count));
  const maxStatus = Math.max(1, ...d.statusDistribution.map((x) => x.count));

  return (
    <div className="space-y-4">
      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { l: '在途事项', v: k.inProgress, sub: '跟进中', c: 'text-accent' },
          { l: '已超时', v: k.overdue, sub: '需立即处理', c: 'text-danger' },
          { l: '本周到期', v: k.dueThisWeek, sub: '7 日内到期', c: 'text-warn' },
          { l: '本月结清', v: k.settledThisMonth, sub: 'SETTLED', c: 'text-accent' },
          { l: '在途总金额', v: k.totalAmountWan, sub: 'CNY', c: 'text-ink' },
        ].map((it) => (
          <Card key={it.l}>
            <div className="text-xs text-ink-3">{it.l}</div>
            <div className={`text-2xl font-bold mt-1 ${it.c}`}>{it.v}</div>
            <div className="text-[10px] text-ink-3 mt-0.5">{it.sub}</div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 原因分布 */}
        <Card>
          <div className="text-sm font-semibold mb-3">原因分布（在途）</div>
          <div className="space-y-2.5">
            {d.reasonDistribution.map((r) => (
              <div key={r.reasonType}>
                <div className="flex justify-between text-xs mb-1"><span className="text-ink">{r.label}</span><span className="text-ink-3">{r.count} 件 · {r.amountWan}</span></div>
                <div className="h-2 bg-canvas rounded-full overflow-hidden"><div className="h-full bg-accent rounded-full" style={{ width: `${(r.count / maxReason) * 100}%` }} /></div>
              </div>
            ))}
          </div>
        </Card>

        {/* 状态分布 */}
        <Card>
          <div className="text-sm font-semibold mb-3">状态分布</div>
          <div className="grid grid-cols-2 gap-2">
            {d.statusDistribution.map((s) => (
              <div key={s.status} className="flex items-center justify-between p-2 rounded bg-canvas/50">
                <span className="text-xs text-ink-2">{s.label}</span>
                <span className="text-sm font-semibold text-ink">{s.count}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-ink-3 mb-2">风险分布</div>
              {d.riskDistribution.map((r) => (
                <div key={r.level} className="flex justify-between text-xs py-0.5"><span className="text-ink-2">{r.label}</span><span className="font-medium">{r.count}</span></div>
              ))}
            </div>
            <div>
              <div className="text-xs text-ink-3 mb-2">账龄分布</div>
              {d.agingDistribution.map((a) => (
                <div key={a.bucket} className="flex justify-between text-xs py-0.5"><span className="text-ink-2">{a.label}</span><span className="font-medium">{a.count} · {a.amountWan}</span></div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      {/* 卡点 + 超时榜 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <div className="text-sm font-semibold mb-3">卡点监控</div>
          <div className="space-y-3">
            <Stat label="缺凭证节点" value={d.blockers.evidenceMissing} tone="red" hint="凭证未补齐，无法推进" />
            <Stat label="已超时节点" value={d.blockers.overdueCount} tone="amber" hint="超 SLA 未完成" />
            <Stat label="原因未分类" value={d.blockers.unclassified} tone="blue" hint="无法分流到下一节点" />
          </div>
        </Card>
        <div className="lg:col-span-2">
          <TimeoutBoard rows={d.timeoutBoard} />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone, hint }: { label: string; value: number; tone: string; hint: string }) {
  const c = tone === 'red' ? 'text-danger' : tone === 'amber' ? 'text-warn' : 'text-blue';
  return (
    <div className="flex items-center justify-between p-2.5 rounded border border-line-soft">
      <div><div className="text-sm text-ink">{label}</div><div className="text-[11px] text-ink-3">{hint}</div></div>
      <div className={`text-2xl font-bold ${c}`}>{value}</div>
    </div>
  );
}

function TimeoutBoard({ rows }: { rows: Dash['timeoutBoard'] }) {
  const nav = useNavigate();
  const { can } = useAuth();
  return (
    <Card className="h-full">
      <div className="text-sm font-semibold mb-3">超时榜（按逾期时长）</div>
      {rows.length === 0 ? <Empty text="暂无超时事项 🎉" /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-ink-3 text-xs border-b border-line-soft">
              <th className="py-2 px-2 font-medium">案件号</th><th className="py-2 px-2 font-medium">客户</th>
              <th className="py-2 px-2 font-medium text-right">金额</th><th className="py-2 px-2 font-medium">当前节点</th>
              <th className="py-2 px-2 font-medium text-right">逾期</th><th className="py-2 px-2 font-medium">负责人</th><th className="py-2 px-2 font-medium">原因</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.caseNo} className="border-b border-line-soft/60 hover:bg-canvas/50 cursor-pointer" onClick={() => can('case:read') && nav(`/case/${r.caseNo}`)}>
                  <td className="py-2 px-2 font-mono text-accent">{r.caseNo}</td>
                  <td className="py-2 px-2">{r.customerName}</td>
                  <td className="py-2 px-2 text-right font-medium">{r.amountWan}</td>
                  <td className="py-2 px-2">{r.stageName}</td>
                  <td className="py-2 px-2 text-right"><Badge tone="red">{r.overdueHours}h</Badge></td>
                  <td className="py-2 px-2 text-ink-2">{r.ownerName}</td>
                  <td className="py-2 px-2 text-ink-2">{r.reasonLabel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
