import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { api, ApiError, type DemoAccount } from '../lib/api';
import { Spinner } from '../components/ui';

const ROLE_LABEL: Record<string, string> = {
  SYS_ADMIN: '系统管理员', AR_MANAGER: '应收管理', GROUP_LEADER: '集团领导',
  BU_HEAD: '事业部负责人', DEPT_SUPERVISOR: '部门主管', SALES: '销售员',
  LEGAL: '法务', AUDITOR: '审计/纪检',
};

export default function Login() {
  const { login, user } = useAuth();
  const nav = useNavigate();
  const [accounts, setAccounts] = useState<DemoAccount[]>([]);
  const [emp, setEmp] = useState('');
  const [pwd, setPwd] = useState('123456');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { if (user) nav('/cases', { replace: true }); }, [user, nav]);
  useEffect(() => { api.demoAccounts().then((r) => setAccounts(r.accounts)).catch(() => {}); }, []);

  const doLogin = async (employeeNo: string, password = '123456') => {
    setBusy(true); setErr('');
    try { await login(employeeNo, password); nav('/cases', { replace: true }); }
    catch (e) { setErr(e instanceof ApiError ? e.message : '登录失败'); }
    finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'radial-gradient(1200px 600px at 50% -10%, #eaf2ec 0%, #f5f3ee 60%)' }}>
      <div className="w-full max-w-4xl grid md:grid-cols-2 gap-0 card overflow-hidden">
        {/* 左侧品牌 */}
        <div className="bg-accent text-white p-8 flex flex-col justify-between">
          <div>
            <div className="w-12 h-12 rounded-lg bg-white/15 flex items-center justify-center text-2xl font-bold mb-4">逾</div>
            <h1 className="text-2xl font-bold leading-snug">应收账款<br />逾期跟进协作平台</h1>
            <p className="mt-3 text-white/80 text-sm leading-relaxed">制造业国企 · 8 节点流程 · 5 项卡控 · 四级组织隔离 · 超时三级升级 · 审计留痕</p>
          </div>
          <div className="text-xs text-white/70 space-y-1">
            <div>✓ 凭证驱动的节点完成校验</div>
            <div>✓ 按原因分流（我方单据 → 内部整改）</div>
            <div>✓ 数据范围与字段级脱敏</div>
            <div>✓ Outbox 站内通知 + 幂等完成</div>
          </div>
        </div>
        {/* 右侧登录 */}
        <div className="p-8">
          <h2 className="text-lg font-semibold text-ink mb-1">登录</h2>
          <p className="text-xs text-ink-3 mb-4">选择演示账号一键登录（密码统一 123456）</p>

          <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto pr-1 mb-5">
            {accounts.map((a) => (
              <button key={a.employeeNo} disabled={busy}
                onClick={() => doLogin(a.employeeNo)}
                className="text-left p-2.5 rounded-md border border-line-soft hover:border-accent hover:bg-accent/5 transition-colors disabled:opacity-50">
                <div className="text-sm font-medium text-ink truncate">{a.name}</div>
                <div className="text-[11px] text-ink-3 truncate">{ROLE_LABEL[a.role] || a.role} · {a.orgName}</div>
              </button>
            ))}
          </div>

          <div className="border-t border-line-soft pt-4">
            <label className="text-xs text-ink-3">工号</label>
            <input className="input mt-1 mb-2" value={emp} onChange={(e) => setEmp(e.target.value)} placeholder="如 wangfang" />
            <label className="text-xs text-ink-3">密码</label>
            <input className="input mt-1" type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} />
            {err && <div className="text-xs text-danger mt-2">{err}</div>}
            <button disabled={busy || !emp} onClick={() => doLogin(emp, pwd)} className="btn-primary w-full mt-3">
              {busy ? <Spinner /> : '登 录'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
