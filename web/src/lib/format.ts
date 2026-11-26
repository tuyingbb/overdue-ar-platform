/** 金额：分 → "386.0万" */
export function fmtWan(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  return (cents / 1000000).toFixed(1) + '万';
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 相对时间：刚刚 / x分钟前 / x小时前 / x天前 / 日期 */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso).getTime();
  if (isNaN(d)) return iso;
  const diff = Date.now() - d;
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  return fmtDate(iso);
}

export function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
