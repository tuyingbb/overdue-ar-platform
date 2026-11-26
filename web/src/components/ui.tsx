import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { useEffect } from 'react';

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-block w-4 h-4 border-2 border-line border-t-accent rounded-full animate-spin ${className}`} />
  );
}

export function Empty({ text = '暂无数据', icon = '📭' }: { text?: string; icon?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-ink-3">
      <div className="text-3xl mb-2 opacity-60">{icon}</div>
      <div className="text-sm">{text}</div>
    </div>
  );
}

const TONES: Record<string, string> = {
  gray: 'bg-canvas text-ink-3 border-line',
  green: 'bg-green-50 text-accent border-green-200',
  amber: 'bg-amber-50 text-warn border-amber-200',
  red: 'bg-red-50 text-danger border-red-200',
  blue: 'bg-blue-50 text-blue border-blue-200',
  ink: 'bg-ink/5 text-ink border-line',
};

export function Badge({ tone = 'gray', children }: { tone?: string; children: ReactNode }) {
  return <span className={`chip border ${TONES[tone] || TONES.gray}`}>{children}</span>;
}

export function toneForRisk(level: string): string {
  return { CRITICAL: 'red', HIGH: 'amber', MEDIUM: 'blue', LOW: 'green' }[level] || 'gray';
}
export function toneForStatus(status: string): string {
  return {
    SETTLED: 'green', LEGAL: 'red', WRITTEN_OFF: 'gray',
    EXECUTING: 'blue', PLAN_PENDING: 'amber', IN_PROGRESS: 'green',
    INTERNAL_RECTIFY: 'blue', REASON_CHECK: 'amber', PENDING_ASSIGN: 'gray',
  }[status] || 'gray';
}
export function toneForStageStatus(s: string): string {
  return { DONE: 'green', ACTIVE: 'green', PENDING: 'gray', CANCELLED: 'gray', OVERDUE: 'red' }[s] || 'gray';
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card p-4 ${className}`}>{children}</div>;
}

export function SectionTitle({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="flex items-start justify-between mb-3">
      <div>
        <h3 className="text-base font-semibold text-ink">{title}</h3>
        {sub && <p className="text-xs text-ink-3 mt-0.5">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function Modal({ open, title, onClose, children, footer, width = 'max-w-md' }: {
  open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onClick={onClose}>
      <div className={`card w-full ${width} p-0 overflow-hidden`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-line-soft">
          <h3 className="font-semibold text-ink">{title}</h3>
          <button onClick={onClose} className="text-ink-3 hover:text-ink text-lg leading-none">×</button>
        </div>
        <div className="px-5 py-4 max-h-[70vh] overflow-y-auto">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-line-soft flex justify-end gap-2 bg-canvas/40">{footer}</div>}
      </div>
    </div>
  );
}

/* ============ Toast ============ */
interface ToastItem { id: number; type: 'info' | 'success' | 'error'; msg: string; }
const ToastCtx = createContext<{ push: (t: Omit<ToastItem, 'id'>) => void } | null>(null);
export function useToast() {
  const v = useContext(ToastCtx);
  if (!v) return { push: () => {} };
  return v;
}
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((t: Omit<ToastItem, 'id'>) => {
    const id = Date.now() + Math.random();
    setItems((p) => [...p, { ...t, id }]);
    setTimeout(() => setItems((p) => p.filter((x) => x.id !== id)), 3200);
  }, []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="fixed top-4 right-4 z-[60] flex flex-col gap-2 w-80">
        {items.map((t) => (
          <div key={t.id} className={`card px-4 py-3 text-sm border-l-4 ${
            t.type === 'success' ? 'border-l-green-500' : t.type === 'error' ? 'border-l-red-500' : 'border-l-blue-500'
          }`}>
            <div className={t.type === 'error' ? 'text-danger' : t.type === 'success' ? 'text-accent' : 'text-blue'}>{t.msg}</div>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/** 阶段进度条 */
export function StageStepper({ stages, currentCode }: { stages: { seq: number; code: string; name: string; status: string }[]; currentCode?: string }) {
  const sorted = [...stages].sort((a, b) => a.seq - b.seq);
  return (
    <div className="flex items-center overflow-x-auto pb-2">
      {sorted.map((s, i) => {
        const done = s.status === 'DONE' || s.status === 'CANCELLED';
        const active = s.code === currentCode || s.status === 'ACTIVE';
        const cancelled = s.status === 'CANCELLED';
        return (
          <div key={s.code} className="flex items-center">
            <div className="flex flex-col items-center min-w-[88px]">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold border-2 ${
                done ? 'bg-accent text-white border-accent' : active ? 'bg-white text-accent border-accent ring-4 ring-accent/15' : 'bg-white text-ink-3 border-line'
              }`}>
                {done ? '✓' : cancelled ? '–' : s.seq}
              </div>
              <div className={`text-xs mt-1.5 ${active ? 'text-accent font-semibold' : done ? 'text-ink-2' : 'text-ink-3'}`}>{s.name}</div>
            </div>
            {i < sorted.length - 1 && <div className={`h-0.5 w-8 ${done ? 'bg-accent' : 'bg-line'}`} />}
          </div>
        );
      })}
    </div>
  );
}

/** 数据行 */
export function DataRow({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3 py-1.5 text-sm">
      <span className="text-ink-3 shrink-0">{label}</span>
      <span className={`text-ink text-right ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}

/** 给组件挂载时拉取数据的小 hook */
export function useMount<T>(fn: () => Promise<T>, deps: any[]): [T | null, boolean, any] {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<any>(null);
  useEffect(() => {
    let alive = true;
    setLoading(true); setErr(null);
    fn().then((d) => { if (alive) { setData(d); setLoading(false); } })
      .catch((e) => { if (alive) { setErr(e); setLoading(false); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return [data, loading, err];
}
