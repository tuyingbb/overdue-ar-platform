import crypto from 'node:crypto';

export function now(): string {
  return new Date().toISOString();
}

export function toISO(d: Date | string): string {
  return typeof d === 'string' ? d : d.toISOString();
}

export function parseISO(s?: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export function hoursBetween(a: Date, b: Date): number {
  return Math.max(0, Math.floor((b.getTime() - a.getTime()) / 3_600_000));
}

export function uid(prefix = ''): string {
  return prefix + crypto.randomBytes(9).toString('hex');
}

export function uuid(): string {
  return crypto.randomUUID();
}

export function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

export function hashPassword(password: string, salt: string): string {
  return sha256(salt + '::' + password);
}

export function genSalt(): string {
  return crypto.randomBytes(8).toString('hex');
}

export function randomCaseNo(seq: number): string {
  const d = new Date();
  const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
  return `OD-${ym}-${String(seq).padStart(4, '0')}`;
}

// 金额展示：分 → 万元（保留 1 位小数），与原型口径一致
export function fmtWan(cents: number): string {
  const wan = cents / 1_000_000;
  return wan >= 100 ? wan.toFixed(0) : wan.toFixed(1);
}

export function moneyFromYuan(yuan: number): number {
  // 内部统一存「分」
  return Math.round(yuan * 100);
}

export function yuanFromCents(cents: number): number {
  return cents / 100;
}

export function jparse<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

export function jstring(v: unknown): string {
  return JSON.stringify(v);
}

// 把 DB 行（null prototype 对象）转普通对象
export function plain<T = Record<string, unknown>>(row: unknown): T {
  if (!row) return {} as T;
  return { ...(row as object) } as T;
}

export function camelKeys(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(row)) {
    const ck = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    out[ck] = row[k];
  }
  return out;
}
