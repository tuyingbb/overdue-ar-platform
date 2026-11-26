import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { api, type Notice } from '../lib/api';
import { fmtDateTime } from '../lib/format';

const NAV: { group: string; items: { to: string; label: string; icon: string; perm?: string }[] }[] = [
  { group: '处置', items: [
    { to: '/cases', label: '逾期台账', icon: '📒' },
    { to: '/tasks', label: '我的待办', icon: '✅' },
  ]},
  { group: '分析', items: [
    { to: '/dashboard', label: '管理看板', icon: '📊' },
  ]},
  { group: '配置', items: [
    { to: '/flow', label: '流程配置', icon: '⚙️', perm: 'admin:config' },
  ]},
];

export default function Layout() {
  const { user, logout, can } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();
  const [unread, setUnread] = useState(0);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [openNotif, setOpenNotif] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);

  useEffect(() => {
    api.notifications().then((r) => { setNotices(r.list || []); setUnread(r.unread || 0); }).catch(() => {});
  }, [loc.pathname]);
  useEffect(() => { setMobileNav(false); }, [loc.pathname]);

  const markAll = async () => { try { await api.markAllRead(); setUnread(0); setNotices((p) => p.map((n) => ({ ...n, read: 1 }))); } catch { /* */ } };

  const navContent = (onNav?: () => void) => (
    <>
      <div className="h-16 flex items-center px-5 border-b border-line-soft shrink-0">
        <div className="w-8 h-8 rounded-md bg-accent text-white flex items-center justify-center font-bold mr-2">逾</div>
        <div>
          <div className="font-bold text-ink leading-tight">逾期跟进</div>
          <div className="text-[10px] text-ink-3">协作平台</div>
        </div>
      </div>
      <nav className="flex-1 py-3 overflow-y-auto">
        {NAV.map((g) => (
          <div key={g.group} className="mb-2">
            <div className="px-5 py-1.5 text-[11px] text-ink-3 tracking-wider">{g.group}</div>
            {g.items.filter((i) => !i.perm || can(i.perm)).map((i) => {
              const active = loc.pathname === i.to;
              return (
                <Link key={i.to} to={i.to} onClick={onNav}
                  className={`flex items-center gap-2.5 px-5 py-2 text-sm ${active ? 'bg-accent/10 text-accent font-medium border-r-2 border-accent' : 'text-ink-2 hover:bg-canvas'}`}>
                  <span>{i.icon}</span>{i.label}
                </Link>
              );
            })}
          </div>
        ))}
        <div className="mb-2">
          <div className="px-5 py-1.5 text-[11px] text-ink-3 tracking-wider">移动</div>
          <Link to="/m" onClick={onNav} className={`flex items-center gap-2.5 px-5 py-2 text-sm ${loc.pathname.startsWith('/m') ? 'bg-accent/10 text-accent font-medium border-r-2 border-accent' : 'text-ink-2 hover:bg-canvas'}`}>
            <span>📱</span>移动端 H5
          </Link>
        </div>
      </nav>
      <div className="p-3 border-t border-line-soft text-[10px] text-ink-3 leading-relaxed shrink-0">
        v1.0 · 模块化单体<br />Node + SQLite · 8h 会话
      </div>
    </>
  );

  return (
    <div className="min-h-screen flex">
      {/* 桌面侧边栏 */}
      <aside className="hidden lg:flex w-56 shrink-0 bg-surface border-r border-line flex-col">
        {navContent()}
      </aside>

      {/* 移动端抽屉导航 */}
      {mobileNav && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <aside className="w-56 bg-surface border-r border-line flex flex-col h-full shadow-xl">
            {navContent(() => setMobileNav(false))}
          </aside>
          <div className="flex-1 bg-ink/40" onClick={() => setMobileNav(false)} />
        </div>
      )}

      {/* 主区 */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-surface border-b border-line flex items-center justify-between px-4 lg:px-6 shrink-0 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <button className="lg:hidden w-9 h-9 rounded-md hover:bg-canvas flex items-center justify-center text-ink-2 shrink-0" onClick={() => setMobileNav(true)} aria-label="菜单">☰</button>
            <h1 className="text-base lg:text-lg font-semibold text-ink truncate">
              {NAV.flatMap((g) => g.items).find((i) => loc.pathname === i.to)?.label || (loc.pathname.startsWith('/m') ? '移动端 H5' : '事项详情')}
            </h1>
          </div>
          <div className="flex items-center gap-2 lg:gap-3 shrink-0">
            <div className="relative">
              <button onClick={() => setOpenNotif((v) => !v)} className="relative w-9 h-9 rounded-full bg-canvas hover:bg-canvas/70 flex items-center justify-center text-ink-2">
                🔔
                {unread > 0 && <span className="absolute -top-0.5 -right-0.5 bg-danger text-white text-[10px] min-w-[16px] h-4 px-1 rounded-full flex items-center justify-center">{unread}</span>}
              </button>
              {openNotif && (
                <div className="absolute right-0 mt-2 w-72 max-w-[calc(100vw-1.5rem)] card p-0 z-40" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-line-soft">
                    <span className="font-medium text-sm">通知</span>
                    {unread > 0 && <button onClick={markAll} className="text-xs text-accent">全部已读</button>}
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {notices.length === 0 ? <div className="py-8 text-center text-sm text-ink-3">暂无通知</div> :
                      notices.slice(0, 20).map((n) => (
                        <div key={n.id} className={`px-4 py-2.5 border-b border-line-soft/60 text-sm ${n.read ? 'opacity-60' : ''}`}>
                          <div className="font-medium text-ink">{n.title}</div>
                          {n.content && <div className="text-xs text-ink-3 mt-0.5">{n.content}</div>}
                          <div className="text-[10px] text-ink-3 mt-1">{fmtDateTime(n.created_at)}</div>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 pl-2 lg:pl-3 border-l border-line-soft">
              <div className="w-8 h-8 rounded-full bg-accent text-white flex items-center justify-center text-sm font-medium">{user?.name?.[0]}</div>
              <div className="leading-tight hidden sm:block">
                <div className="text-sm font-medium text-ink">{user?.name}</div>
                <div className="text-[11px] text-ink-3">{user?.orgName} · {user?.primaryRole}</div>
              </div>
              <button onClick={async () => { await logout(); nav('/login'); }} className="text-xs text-ink-3 hover:text-danger ml-1">退出</button>
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
