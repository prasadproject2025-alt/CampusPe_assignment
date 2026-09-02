import { DatabaseSync } from 'node:sqlite'
import { chmodSync, existsSync } from 'node:fs'
import { databasePath } from './config.js'

export const db = new DatabaseSync(databasePath)

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

  CREATE TABLE IF NOT EXISTS profiles (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    phone TEXT NOT NULL DEFAULT '',
    phone_country_code TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '',
    current_city TEXT NOT NULL DEFAULT '',
    current_state TEXT NOT NULL DEFAULT '',
    current_country TEXT NOT NULL DEFAULT '',
    linkedin_url TEXT NOT NULL DEFAULT '',
    github_url TEXT NOT NULL DEFAULT '',
    portfolio_url TEXT NOT NULL DEFAULT '',
    experience_years TEXT NOT NULL DEFAULT '',
    notice_period TEXT NOT NULL DEFAULT '',
    work_authorized TEXT NOT NULL DEFAULT '',
    sponsorship TEXT NOT NULL DEFAULT '',
    current_salary TEXT NOT NULL DEFAULT '',
    expected_salary TEXT NOT NULL DEFAULT '',
    work_arrangement TEXT NOT NULL DEFAULT '',
    willing_in_office TEXT NOT NULL DEFAULT '',
    willing_relocate TEXT NOT NULL DEFAULT '',
    us_work_authorized TEXT NOT NULL DEFAULT '',
    us_sponsorship TEXT NOT NULL DEFAULT '',
    us_visa_type TEXT NOT NULL DEFAULT '',
    active_immigration_case TEXT NOT NULL DEFAULT '',
    referral_source TEXT NOT NULL DEFAULT '',
    career_motivation TEXT NOT NULL DEFAULT '',
    cover_letter_intro TEXT NOT NULL DEFAULT '',
    additional_information TEXT NOT NULL DEFAULT '',
    experiences_json TEXT NOT NULL DEFAULT '[]',
    education_json TEXT NOT NULL DEFAULT '[]',
    demographics_encrypted TEXT,
    allow_demographic_suggestions INTEGER NOT NULL DEFAULT 0,
    resume_filename TEXT,
    resume_storage_name TEXT,
    resume_mime TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS answer_memory (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    question_text TEXT NOT NULL,
    normalized_question TEXT NOT NULL,
    canonical_field TEXT,
    field_type TEXT NOT NULL,
    answer_encrypted TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'global' CHECK (scope IN ('global', 'company')),
    company TEXT,
    approved_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_used_at TEXT,
    usage_count INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_answer_memory_user_normalized ON answer_memory(user_id, normalized_question);
  CREATE INDEX IF NOT EXISTS idx_answer_memory_user_canonical ON answer_memory(user_id, canonical_field);

  CREATE TABLE IF NOT EXISTS resolution_log (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    question_text TEXT NOT NULL,
    normalized_question TEXT NOT NULL,
    canonical_field TEXT,
    status TEXT NOT NULL,
    source TEXT,
    confidence REAL,
    reason TEXT,
    company TEXT,
    job_title TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_resolution_log_user_created ON resolution_log(user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS automation_runs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    job_url TEXT NOT NULL,
    job_board TEXT NOT NULL,
    status TEXT NOT NULL,
    current_step TEXT NOT NULL,
    job_json TEXT,
    questions_json TEXT,
    pause_json TEXT,
    error_message TEXT,
    auto_submit INTEGER NOT NULL DEFAULT 0,
    test_mode INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_automation_runs_user_created ON automation_runs(user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS automation_events (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES automation_runs(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    message TEXT NOT NULL,
    detail_json TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_automation_events_run_created ON automation_events(run_id, created_at);

  CREATE TABLE IF NOT EXISTS saved_jobs (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    job_id TEXT NOT NULL,
    job_json TEXT NOT NULL,
    saved_at TEXT NOT NULL,
    PRIMARY KEY (user_id, job_id)
  );
  CREATE INDEX IF NOT EXISTS idx_saved_jobs_user_saved ON saved_jobs(user_id, saved_at DESC);

  CREATE TABLE IF NOT EXISTS resume_optimizations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    job_url TEXT NOT NULL,
    job_title TEXT NOT NULL,
    company TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('review', 'automatic')),
    status TEXT NOT NULL CHECK (status IN ('DRAFT', 'APPROVED')),
    proposal_json TEXT NOT NULL,
    storage_name TEXT,
    created_at TEXT NOT NULL,
    approved_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_resume_optimizations_user_created ON resume_optimizations(user_id, created_at DESC);
`)

const profileColumns = new Set((db.prepare('PRAGMA table_info(profiles)').all() as Array<{ name: string }>).map((column) => column.name))
const profileMigrations: Array<[string, string]> = [
  ['current_salary', "TEXT NOT NULL DEFAULT ''"],
  ['phone_country_code', "TEXT NOT NULL DEFAULT ''"],
  ['github_url', "TEXT NOT NULL DEFAULT ''"], ['willing_in_office', "TEXT NOT NULL DEFAULT ''"], ['willing_relocate', "TEXT NOT NULL DEFAULT ''"],
  ['us_work_authorized', "TEXT NOT NULL DEFAULT ''"], ['us_sponsorship', "TEXT NOT NULL DEFAULT ''"], ['us_visa_type', "TEXT NOT NULL DEFAULT ''"], ['active_immigration_case', "TEXT NOT NULL DEFAULT ''"],
  ['referral_source', "TEXT NOT NULL DEFAULT ''"], ['career_motivation', "TEXT NOT NULL DEFAULT ''"], ['cover_letter_intro', "TEXT NOT NULL DEFAULT ''"],
  ['additional_information', "TEXT NOT NULL DEFAULT ''"],
  ['current_city', "TEXT NOT NULL DEFAULT ''"], ['current_state', "TEXT NOT NULL DEFAULT ''"], ['current_country', "TEXT NOT NULL DEFAULT ''"],
]
for (const [name, definition] of profileMigrations) if (!profileColumns.has(name)) db.exec(`ALTER TABLE profiles ADD COLUMN ${name} ${definition}`)

const automationRunColumns = new Set((db.prepare('PRAGMA table_info(automation_runs)').all() as Array<{ name: string }>).map((column) => column.name))
if (!automationRunColumns.has('auto_submit')) db.exec('ALTER TABLE automation_runs ADD COLUMN auto_submit INTEGER NOT NULL DEFAULT 0')
if (!automationRunColumns.has('test_mode')) db.exec('ALTER TABLE automation_runs ADD COLUMN test_mode INTEGER NOT NULL DEFAULT 0')

const optimizationColumns = new Set((db.prepare('PRAGMA table_info(resume_optimizations)').all() as Array<{ name: string }>).map((column) => column.name))
if (!optimizationColumns.has('storage_name')) db.exec('ALTER TABLE resume_optimizations ADD COLUMN storage_name TEXT')

db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString())

for (const path of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
  if (existsSync(path)) chmodSync(path, 0o600)
}
