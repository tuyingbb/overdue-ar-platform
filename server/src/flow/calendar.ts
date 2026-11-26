import { allRows } from '../db/index.js';

const SH_OFFSET = 8 * 3600 * 1000;

/** 转上海时区的 YYYY-MM-DD */
export function shDate(d: Date): string {
  const t = new Date(d.getTime() + SH_OFFSET);
  return t.toISOString().slice(0, 10);
}

export function shDateTime(d: Date): string {
  const t = new Date(d.getTime() + SH_OFFSET);
  return t.toISOString().replace('T', ' ').slice(0, 16);
}

let holidayMap: Map<string, boolean> | null = null;
function getCal(): Map<string, boolean> {
  if (!holidayMap) {
    const rows = allRows<{ cal_date: string; is_workday: number }>(`select cal_date, is_workday from work_calendar`);
    holidayMap = new Map();
    for (const r of rows) holidayMap.set(r.cal_date, !!r.is_workday);
  }
  return holidayMap;
}

export function reloadCalendar() {
  holidayMap = null;
}

/** 上海日历下某一天是否工作日 */
export function isWorkday(date: Date): boolean {
  const key = shDate(date);
  const cal = getCal();
  if (cal.has(key)) return cal.get(key)!;
  const day = new Date(date.getTime() + SH_OFFSET).getUTCDay(); // 0=Sun..6=Sat in shanghai local
  return day !== 0 && day !== 6;
}

/** 从 start 起算第 n 个工作日，到期时间固定为当日 18:00（上海） */
export function addWorkdays(start: Date, n: number): Date {
  let d = new Date(start.getTime());
  let counted = 0;
  // 当天是否计入：起算当日若已过 18:00 则从次日起算
  const sh = new Date(d.getTime() + SH_OFFSET);
  if (sh.getUTCHours() >= 18) {
    d = new Date(d.getTime() + 24 * 3600 * 1000);
  }
  while (counted < n) {
    if (isWorkday(d)) counted++;
    if (counted < n) d = new Date(d.getTime() + 24 * 3600 * 1000);
  }
  // 设为当日 18:00 上海
  const base = new Date(Date.UTC(1970, 0, 1));
  const shD = new Date(d.getTime() + SH_OFFSET);
  const target = new Date(Date.UTC(shD.getUTCFullYear(), shD.getUTCMonth(), shD.getUTCDate(), 18, 0, 0) - SH_OFFSET);
  return target;
}

export function addNaturalDays(start: Date, n: number): Date {
  return new Date(start.getTime() + n * 24 * 3600 * 1000);
}

export function addHours(start: Date, n: number): Date {
  return new Date(start.getTime() + n * 3600 * 1000);
}

/** 两个时刻之间的工作日数（向上取整，用于升级阈值判断） */
export function workdaysBetween(from: Date, to: Date): number {
  if (to <= from) return 0;
  let count = 0;
  let d = new Date(from.getTime());
  // 按天步进
  while (d < to) {
    if (isWorkday(d)) count++;
    d = new Date(d.getTime() + 24 * 3600 * 1000);
  }
  return count;
}
