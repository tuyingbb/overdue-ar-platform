// 24 张核心 + 支撑表（PostgreSQL DDL 移植到 SQLite：jsonb→TEXT、timestamptz→TEXT ISO、分区省略、列级权限在服务层实现）
export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

-- ===== 组织与权限 =====
CREATE TABLE IF NOT EXISTS org_unit (
  id INTEGER PRIMARY KEY,
  parent_id INTEGER REFERENCES org_unit(id),
  path TEXT NOT NULL,
  name TEXT NOT NULL,
  level INTEGER NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_path ON org_unit(path);
CREATE INDEX IF NOT EXISTS idx_org_parent ON org_unit(parent_id);

CREATE TABLE IF NOT EXISTS app_user (
  id INTEGER PRIMARY KEY,
  employee_no TEXT NOT NULL,
  name TEXT NOT NULL,
  org_id INTEGER NOT NULL REFERENCES org_unit(id),
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_emp ON app_user(employee_no);

CREATE TABLE IF NOT EXISTS role (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  amount_visible INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_role_code ON role(code);

CREATE TABLE IF NOT EXISTS user_role (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES app_user(id),
  role_id INTEGER NOT NULL REFERENCES role(id),
  org_id INTEGER REFERENCES org_unit(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_role ON user_role(user_id, role_id, org_id);

CREATE TABLE IF NOT EXISTS data_grant (
  id INTEGER PRIMARY KEY,
  subject_id INTEGER NOT NULL,
  scope_type TEXT NOT NULL,
  org_id INTEGER,
  amount_visible INTEGER NOT NULL DEFAULT 0,
  customer_visible INTEGER NOT NULL DEFAULT 1,
  contract_visible INTEGER NOT NULL DEFAULT 1,
  expire_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_grant_subject ON data_grant(subject_id, expire_at);

CREATE TABLE IF NOT EXISTS temp_grant (
  id INTEGER PRIMARY KEY,
  grantee_id INTEGER NOT NULL,
  org_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  approved_by INTEGER,
  expire_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_temp_expire ON temp_grant(expire_at);

-- ===== 流程配置 =====
CREATE TABLE IF NOT EXISTS flow_template (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  condition_json TEXT,
  remark TEXT,
  published_by INTEGER,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tpl_ver ON flow_template(code, version);

CREATE TABLE IF NOT EXISTS stage_def (
  id INTEGER PRIMARY KEY,
  template_id INTEGER NOT NULL REFERENCES flow_template(id),
  code TEXT NOT NULL,
  seq INTEGER NOT NULL,
  name TEXT NOT NULL,
  owner_role TEXT NOT NULL,
  sla_value INTEGER NOT NULL,
  sla_unit TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  escalation_json TEXT NOT NULL DEFAULT '[]',
  next_json TEXT NOT NULL DEFAULT '{}',
  block_next INTEGER NOT NULL DEFAULT 1,
  is_terminal INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_stage_code ON stage_def(template_id, code);

CREATE TABLE IF NOT EXISTS work_calendar (
  id INTEGER PRIMARY KEY,
  cal_date TEXT NOT NULL,
  is_workday INTEGER NOT NULL DEFAULT 1,
  org_id INTEGER,
  remark TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cal_date ON work_calendar(cal_date, org_id);

-- ===== 事项运行 =====
CREATE TABLE IF NOT EXISTS overdue_case (
  id INTEGER PRIMARY KEY,
  case_no TEXT NOT NULL,
  erp_ar_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  contract_no TEXT,
  sales_order_no TEXT,
  overdue_amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CNY',
  aging_bucket TEXT NOT NULL,
  overdue_days INTEGER NOT NULL,
  reason_type TEXT NOT NULL DEFAULT 'PENDING',
  internal_dept_id INTEGER,
  risk_level TEXT NOT NULL DEFAULT 'MEDIUM',
  owner_id INTEGER,
  org_id INTEGER NOT NULL REFERENCES org_unit(id),
  case_status TEXT NOT NULL,
  is_paused INTEGER NOT NULL DEFAULT 0,
  paused_at TEXT,
  pause_minutes INTEGER NOT NULL DEFAULT 0,
  template_version_id INTEGER NOT NULL,
  current_stage_id INTEGER,
  erp_synced_at TEXT NOT NULL,
  closed_at TEXT,
  row_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_case_no ON overdue_case(case_no);
CREATE UNIQUE INDEX IF NOT EXISTS uq_case_ar ON overdue_case(erp_ar_id);
CREATE INDEX IF NOT EXISTS idx_case_ledger ON overdue_case(org_id, case_status, risk_level, overdue_amount_cents DESC);
CREATE INDEX IF NOT EXISTS idx_case_owner ON overdue_case(owner_id, case_status);

CREATE TABLE IF NOT EXISTS case_stage (
  id INTEGER PRIMARY KEY,
  case_id INTEGER NOT NULL REFERENCES overdue_case(id),
  stage_code TEXT NOT NULL,
  seq INTEGER NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  assignee_id INTEGER,
  assignee_dept_id INTEGER,
  spec_snapshot TEXT NOT NULL,
  started_at TEXT,
  due_at TEXT,
  completed_at TEXT,
  overdue_hours INTEGER NOT NULL DEFAULT 0,
  overdue_workdays INTEGER NOT NULL DEFAULT 0,
  escalation_level INTEGER NOT NULL DEFAULT 0,
  row_version INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_case_stage ON case_stage(case_id, stage_code);
CREATE INDEX IF NOT EXISTS idx_stage_scan ON case_stage(due_at) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_stage_case ON case_stage(case_id, seq);
CREATE INDEX IF NOT EXISTS idx_stage_assignee ON case_stage(assignee_id, status);

CREATE TABLE IF NOT EXISTS evidence (
  id INTEGER PRIMARY KEY,
  case_id INTEGER NOT NULL REFERENCES overdue_case(id),
  stage_id INTEGER REFERENCES case_stage(id),
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  file_key TEXT,
  sha256 TEXT,
  size INTEGER,
  note TEXT,
  uploaded_by INTEGER,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
  bound INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ev_case ON evidence(case_id, stage_id);

CREATE TABLE IF NOT EXISTS case_transition (
  id INTEGER PRIMARY KEY,
  case_id INTEGER NOT NULL REFERENCES overdue_case(id),
  event TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  stage_code TEXT,
  operator_id INTEGER,
  note TEXT,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_trans_case ON case_transition(case_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS case_pause (
  id INTEGER PRIMARY KEY,
  case_id INTEGER NOT NULL REFERENCES overdue_case(id),
  paused_at TEXT NOT NULL,
  resumed_at TEXT,
  reason TEXT NOT NULL,
  operator_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_pause_case ON case_pause(case_id);

CREATE TABLE IF NOT EXISTS communication_log (
  id INTEGER PRIMARY KEY,
  case_id INTEGER NOT NULL REFERENCES overdue_case(id),
  channel TEXT NOT NULL,
  contact TEXT,
  conclusion TEXT NOT NULL,
  next_commitment_at TEXT,
  operator_id INTEGER,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_comm_case ON communication_log(case_id, occurred_at DESC);

-- ===== 集成与通知 =====
CREATE TABLE IF NOT EXISTS approval_ref (
  id INTEGER PRIMARY KEY,
  case_id INTEGER NOT NULL REFERENCES overdue_case(id),
  type TEXT NOT NULL,
  process_no TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  source TEXT NOT NULL DEFAULT 'MANUAL',
  synced_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_approval_process ON approval_ref(process_no);

CREATE TABLE IF NOT EXISTS erp_import_batch (
  id INTEGER PRIMARY KEY,
  file_name TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PROCESSING',
  operator_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_batch_created ON erp_import_batch(created_at DESC);

CREATE TABLE IF NOT EXISTS erp_import_row (
  id INTEGER PRIMARY KEY,
  batch_id INTEGER NOT NULL REFERENCES erp_import_batch(id),
  row_no INTEGER NOT NULL,
  raw_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  error_code TEXT,
  error_msg TEXT,
  case_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_row_batch ON erp_import_row(batch_id, status);

CREATE TABLE IF NOT EXISTS sync_error (
  id INTEGER PRIMARY KEY,
  batch_id INTEGER,
  row_no INTEGER,
  raw_json TEXT,
  error_code TEXT NOT NULL,
  error_msg TEXT,
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sync_status ON sync_error(resolved);

CREATE TABLE IF NOT EXISTS outbox_event (
  id INTEGER PRIMARY KEY,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  aggregate_seq INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'NEW',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_outbox_seq ON outbox_event(aggregate_type, aggregate_id, aggregate_seq);
CREATE INDEX IF NOT EXISTS idx_outbox_due ON outbox_event(next_retry_at) WHERE status = 'NEW';

CREATE TABLE IF NOT EXISTS notification (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  channel TEXT NOT NULL DEFAULT 'INAPP',
  status TEXT NOT NULL DEFAULT 'NEW',
  dedupe_key TEXT,
  case_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_notif_dedupe ON notification(dedupe_key);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notification(user_id, status);

CREATE TABLE IF NOT EXISTS escalation_event (
  id INTEGER PRIMARY KEY,
  stage_id INTEGER NOT NULL REFERENCES case_stage(id),
  case_id INTEGER NOT NULL REFERENCES overdue_case(id),
  level INTEGER NOT NULL,
  triggered_at TEXT NOT NULL DEFAULT (datetime('now')),
  suppressed INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_esc_stage_level ON escalation_event(stage_id, level);
CREATE INDEX IF NOT EXISTS idx_esc_case ON escalation_event(case_id);

-- ===== 审计与指标 =====
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
  actor_id INTEGER,
  actor_ip TEXT,
  action TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  result TEXT NOT NULL DEFAULT 'SUCCESS',
  trace_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_object ON audit_log(object_type, object_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS audit_anchor (
  id INTEGER PRIMARY KEY,
  anchor_date TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  prev_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_anchor_date ON audit_anchor(anchor_date);

CREATE TABLE IF NOT EXISTS metric_daily (
  id INTEGER PRIMARY KEY,
  stat_date TEXT NOT NULL,
  org_id INTEGER,
  metric TEXT NOT NULL,
  value REAL NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_metric ON metric_daily(stat_date, org_id, metric);

CREATE TABLE IF NOT EXISTS idempotency_record (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  idem_key TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  response TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_idem ON idempotency_record(user_id, idem_key);

CREATE TABLE IF NOT EXISTS session_store (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_user ON session_store(user_id);
`;
