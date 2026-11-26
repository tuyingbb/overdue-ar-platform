import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { SCHEMA_SQL } from './schema.js';
import { plain } from '../common/util.js';

const DB_DIR = process.env.OVERDUE_DB_DIR || path.join(process.cwd(), 'data');
const DB_PATH = process.env.OVERDUE_DB_PATH || path.join(DB_DIR, 'app.db');

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');
db.exec(SCHEMA_SQL);

export type Row = Record<string, unknown>;

export function getRow<T = Row>(sql: string, ...params: any[]): T | null {
  const s = db.prepare(sql);
  const r = s.get(...params) as Row | null;
  return r ? (plain(r) as T) : null;
}

export function allRows<T = Row>(sql: string, ...params: any[]): T[] {
  const s = db.prepare(sql);
  const rows = s.all(...params) as Row[];
  return rows.map((r) => plain(r) as T);
}

export function run(sql: string, ...params: any[]): { changes: number; lastInsertRowid: number | bigint } {
  const s = db.prepare(sql);
  return s.run(...params) as { changes: number; lastInsertRowid: number | bigint };
}

export function exec(sql: string): void {
  db.exec(sql);
}

/** 事务深度：支持嵌套（内层用 SAVEPOINT） */
let txDepth = 0;
/** 在一个事务里执行 fn；fn 抛错则回滚；嵌套调用自动降级为 SAVEPOINT */
export function tx<T>(fn: () => T): T {
  const nested = txDepth > 0;
  const name = `sp_${txDepth}`;
  if (nested) db.exec(`SAVEPOINT ${name}`); else db.exec('BEGIN');
  txDepth++;
  try {
    const r = fn();
    txDepth--;
    if (nested) db.exec(`RELEASE SAVEPOINT ${name}`); else db.exec('COMMIT');
    return r;
  } catch (e) {
    txDepth--;
    if (nested) {
      db.exec(`ROLLBACK TO SAVEPOINT ${name}`);
      db.exec(`RELEASE SAVEPOINT ${name}`);
    } else {
      db.exec('ROLLBACK');
    }
    throw e;
  }
}

export function scalar<T = unknown>(sql: string, ...params: any[]): T | null {
  const r = getRow<Record<string, unknown>>(sql, ...params);
  if (!r) return null;
  const k = Object.keys(r)[0];
  return (k ? r[k] : null) as T | null;
}
