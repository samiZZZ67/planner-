-- ====================================================================
-- Night Planner - Neon Postgres Database Schema
-- Run this script in the Neon SQL Editor or via psql
-- ====================================================================

-- 1. Shared Monotonic Sequence for Delta Sync
CREATE SEQUENCE IF NOT EXISTS server_seq START WITH 1 INCREMENT BY 1;

-- 2. Sections Table
CREATE TABLE IF NOT EXISTS sections (
    id VARCHAR(64) PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    icon TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    daily_target_minutes INTEGER,
    target_type VARCHAR(20) DEFAULT 'at least',
    updated_at BIGINT NOT NULL,
    deleted BOOLEAN NOT NULL DEFAULT FALSE,
    is_sample BOOLEAN NOT NULL DEFAULT FALSE,
    server_seq BIGINT NOT NULL DEFAULT nextval('server_seq')
);

CREATE INDEX IF NOT EXISTS idx_sections_server_seq ON sections (server_seq);
CREATE INDEX IF NOT EXISTS idx_sections_updated_at ON sections (updated_at);

-- 3. Tasks Table
CREATE TABLE IF NOT EXISTS tasks (
    id VARCHAR(64) PRIMARY KEY,
    date VARCHAR(10) NOT NULL, -- YYYY-MM-DD
    section_id VARCHAR(64) NOT NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    strategy TEXT DEFAULT '',
    done_means TEXT DEFAULT '',
    estimated_minutes INTEGER NOT NULL DEFAULT 0,
    priority VARCHAR(20) NOT NULL DEFAULT 'Medium',
    must_do BOOLEAN NOT NULL DEFAULT FALSE,
    tags JSONB NOT NULL DEFAULT '[]'::jsonb,
    icon TEXT DEFAULT '',
    text_color TEXT DEFAULT '',
    image TEXT,
    is_completed BOOLEAN NOT NULL DEFAULT FALSE,
    completed_at BIGINT,
    "order" INTEGER NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    deleted BOOLEAN NOT NULL DEFAULT FALSE,
    is_sample BOOLEAN NOT NULL DEFAULT FALSE,
    server_seq BIGINT NOT NULL DEFAULT nextval('server_seq')
);

CREATE INDEX IF NOT EXISTS idx_tasks_server_seq ON tasks (server_seq);
CREATE INDEX IF NOT EXISTS idx_tasks_date ON tasks (date);
CREATE INDEX IF NOT EXISTS idx_tasks_section_id ON tasks (section_id);
CREATE INDEX IF NOT EXISTS idx_tasks_updated_at ON tasks (updated_at);

-- 4. Time Logs Table
CREATE TABLE IF NOT EXISTS time_logs (
    id VARCHAR(64) PRIMARY KEY,
    task_id VARCHAR(64) NOT NULL,
    date VARCHAR(10) NOT NULL, -- YYYY-MM-DD
    minutes INTEGER NOT NULL DEFAULT 0,
    source VARCHAR(20) NOT NULL DEFAULT 'timer', -- 'timer' | 'manual'
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    deleted BOOLEAN NOT NULL DEFAULT FALSE,
    is_sample BOOLEAN NOT NULL DEFAULT FALSE,
    server_seq BIGINT NOT NULL DEFAULT nextval('server_seq')
);

CREATE INDEX IF NOT EXISTS idx_time_logs_server_seq ON time_logs (server_seq);
CREATE INDEX IF NOT EXISTS idx_time_logs_task_id ON time_logs (task_id);
CREATE INDEX IF NOT EXISTS idx_time_logs_date ON time_logs (date);
CREATE INDEX IF NOT EXISTS idx_time_logs_updated_at ON time_logs (updated_at);

-- 5. Days Table (Daily settings & 1-minute end of day review)
CREATE TABLE IF NOT EXISTS days (
    id VARCHAR(10) PRIMARY KEY, -- YYYY-MM-DD
    date VARCHAR(10) NOT NULL,
    free_hours NUMERIC(4,2) DEFAULT 8.0,
    review JSONB DEFAULT '{"worked":"","blocked":"","change":""}'::jsonb,
    updated_at BIGINT NOT NULL,
    deleted BOOLEAN NOT NULL DEFAULT FALSE,
    is_sample BOOLEAN NOT NULL DEFAULT FALSE,
    server_seq BIGINT NOT NULL DEFAULT nextval('server_seq')
);

CREATE INDEX IF NOT EXISTS idx_days_server_seq ON days (server_seq);
CREATE INDEX IF NOT EXISTS idx_days_updated_at ON days (updated_at);

-- 6. Rate Limiting Table (5 attempts / 15 minutes)
CREATE TABLE IF NOT EXISTS auth_rate_limit (
    ip_address VARCHAR(128) PRIMARY KEY,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    last_attempt_at BIGINT NOT NULL,
    blocked_until BIGINT NOT NULL DEFAULT 0
);

-- 7. Weekly Plans Table
CREATE TABLE IF NOT EXISTS weekly_plans (
    id VARCHAR(64) PRIMARY KEY,
    start_date VARCHAR(10) NOT NULL,
    end_date VARCHAR(10) NOT NULL,
    month_id VARCHAR(10) NOT NULL,
    prompt TEXT NOT NULL,
    word_count INTEGER NOT NULL DEFAULT 0,
    goals TEXT DEFAULT '',
    aastu_commitments TEXT DEFAULT '',
    deep_work_targets TEXT DEFAULT '',
    constraints TEXT DEFAULT '',
    outcomes TEXT DEFAULT '',
    ai_weekly_report TEXT,
    status VARCHAR(20) DEFAULT 'active',
    completion_percentage NUMERIC(5,2) DEFAULT 0,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    deleted BOOLEAN NOT NULL DEFAULT FALSE,
    server_seq BIGINT NOT NULL DEFAULT nextval('server_seq')
);

CREATE INDEX IF NOT EXISTS idx_weekly_plans_server_seq ON weekly_plans (server_seq);

-- 8. Monthly Plans Table
CREATE TABLE IF NOT EXISTS monthly_plans (
    id VARCHAR(64) PRIMARY KEY,
    month VARCHAR(10) NOT NULL,
    title TEXT NOT NULL,
    prompt TEXT DEFAULT '',
    academic_priorities TEXT DEFAULT '',
    editing_targets TEXT DEFAULT '',
    commitments TEXT DEFAULT '',
    deliverables TEXT DEFAULT '',
    goals JSONB DEFAULT '[]'::jsonb,
    completion_percentage NUMERIC(5,2) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'active',
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    deleted BOOLEAN NOT NULL DEFAULT FALSE,
    server_seq BIGINT NOT NULL DEFAULT nextval('server_seq')
);

CREATE INDEX IF NOT EXISTS idx_monthly_plans_server_seq ON monthly_plans (server_seq);

-- 9. AI Conversations Table (Cross-device PC ↔ Phone sync & permanent history)
CREATE TABLE IF NOT EXISTS ai_conversations (
    id VARCHAR(128) PRIMARY KEY,
    assistant VARCHAR(32) NOT NULL DEFAULT 'sams_ai',
    title TEXT NOT NULL,
    user_id VARCHAR(64) NOT NULL DEFAULT 'owner',
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    data JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_ai_conversations_assistant ON ai_conversations(assistant, user_id);

-- 10. AI Messages Table
CREATE TABLE IF NOT EXISTS ai_messages (
    id VARCHAR(128) PRIMARY KEY,
    conversation_id VARCHAR(128) NOT NULL,
    role VARCHAR(32) NOT NULL,
    content TEXT NOT NULL,
    timestamp BIGINT NOT NULL,
    provider VARCHAR(64),
    actions JSONB DEFAULT '[]'::jsonb,
    user_id VARCHAR(64) NOT NULL DEFAULT 'owner'
);

CREATE INDEX IF NOT EXISTS idx_ai_messages_conv ON ai_messages(conversation_id);
