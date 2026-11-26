import { useNavigate } from 'react-router-dom';
import { api, type TaskItem } from '../lib/api';
import { Badge, Card, Empty, Spinner, toneForRisk, useMount } from '../components/ui';
import { fmtDateTime } from '../lib/format';

const GROUP_ORDER = ['已超时', '今日到期', '本周到期', '待审批', '已升级', '其他'];
const GROUP_TONE: Record<string, string> = { '已超时': 'red', '今日到期': 'amber', '本周到期': 'blue', '待审批': 'ink', '已升级': 'red' };

export default function MyTasks() {
  const nav = useNavigate();
  const [data, loading] = useMount(() => api.myTasks(), []);
  const groups = data?.groups || {};
  const counts = data?.counts || {};
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const keys = Object.keys(groups).sort((a, b) => (GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b)));

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">我的待办</h2>
            <p className="text-xs text-ink-3 mt-0.5">按紧急度分组，红色为已超时 / 已升级；每条展示卡点所需凭证</p>
          </div>
          <div className="text-sm text-ink-2">待办合计 <span className="text-accent font-bold text-lg">{total}</span></div>
        </div>
      </Card>

      {loading ? <Card><div className="text-center py-10 text-ink-3"><Spinner /> 加载中…</div></Card> :
        keys.length === 0 ? <Card><Empty text="暂无待办，去台账看看吧 👀" icon="🎉" /></Card> :
          keys.map((g) => (
            <Card key={g}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Badge tone={GROUP_TONE[g] || 'gray'}>{g}</Badge>
                  <span className="text-sm font-medium text-ink">{g}</span>
                </div>
                <span className="text-xs text-ink-3">{groups[g].length} 项</span>
              </div>
              <div className="space-y-2">
                {groups[g].map((t) => <TaskRow key={t.caseNo + t.stageId} t={t} onClick={() => nav(`/case/${t.caseNo}`)} />)}
              </div>
            </Card>
          ))}
    </div>
  );
}

function TaskRow({ t, onClick }: { t: TaskItem; onClick: () => void }) {
  const overdue = t.overdueHours > 0;
  return (
    <div onClick={onClick} className="p-3 rounded-md border border-line-soft hover:border-accent hover:bg-accent/[0.03] cursor-pointer transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-accent text-sm">{t.caseNo}</span>
            <span className="font-medium text-ink truncate">{t.customerName}</span>
            <Badge tone={toneForRisk(t.riskLevel)}>{t.riskLevel === 'CRITICAL' ? '极高' : t.riskLevel === 'HIGH' ? '高' : t.riskLevel === 'MEDIUM' ? '中' : '低'}</Badge>
          </div>
          <div className="text-xs text-ink-3 mt-1">{t.amountWan} · 逾期 {t.overdueDays} 天 · {t.reasonLabel}</div>
        </div>
        <div className="text-right shrink-0">
          <div className={`text-sm font-medium ${overdue ? 'text-danger' : 'text-ink'}`}>
            {t.stageName}{overdue ? ` · 超时 ${t.overdueHours}h` : ''}
          </div>
          <div className="text-[11px] text-ink-3 mt-0.5">到期 {fmtDateTime(t.dueAt)}</div>
        </div>
      </div>
      {(t.missing?.length > 0 || t.blockers?.length > 0) && (
        <div className="mt-2 pl-2 border-l-2 border-warn/40">
          {t.missing?.map((m, i) => <div key={i} className="text-xs text-warn">⚠ {m}</div>)}
          {t.blockers?.filter((b) => !t.missing?.includes(b)).map((b, i) => <div key={'b' + i} className="text-xs text-danger">⛔ {b}</div>)}
        </div>
      )}
    </div>
  );
}
