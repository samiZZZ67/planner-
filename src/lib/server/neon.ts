import { neon } from '@neondatabase/serverless';
import type { Section, Task, TimeLog, Day, WeeklyPlan, MonthlyPlan } from '@/types';

export function getDb() {
  let databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || databaseUrl.includes('dummy')) {
    return null;
  }

  // Ensure SSL is enforced for Postgres (Neon) connection
  if (!databaseUrl.includes('sslmode=')) {
    const sep = databaseUrl.includes('?') ? '&' : '?';
    databaseUrl = `${databaseUrl}${sep}sslmode=require`;
  }

  return neon(databaseUrl);
}

export async function checkDbConnection(): Promise<{ ok: boolean; message?: string }> {
  try {
    const sql = getDb();
    if (!sql) {
      return { ok: false, message: 'DATABASE_URL is not configured' };
    }
    const result = await sql`SELECT 1 as connected`;
    return { ok: Array.isArray(result) && result.length > 0 };
  } catch (err: any) {
    return { ok: false, message: err.message || 'Database connection error' };
  }
}


let schemaInitialized = false;

/**
 * Automatically creates tables and sequence if they do not exist
 */
export async function ensureSchema(sql: any): Promise<void> {
  if (schemaInitialized) return;
  try {
    await sql`CREATE SEQUENCE IF NOT EXISTS server_seq START WITH 1 INCREMENT BY 1`;
    await sql`
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
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS tasks (
        id VARCHAR(64) PRIMARY KEY,
        date VARCHAR(10) NOT NULL,
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
      )
    `;
    await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS start_time TEXT`;
    await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS end_time TEXT`;
    await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS scheduled_minutes INTEGER`;
    await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS actual_minutes INTEGER`;
    await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'not_started'`;
    await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS deadline VARCHAR(10)`;
    await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS result TEXT`;
    await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_bold BOOLEAN DEFAULT FALSE`;
    await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_underline BOOLEAN DEFAULT FALSE`;
    await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_strikethrough BOOLEAN DEFAULT FALSE`;
    await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS target_minutes INTEGER`;
    await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS expected_completion_time TEXT`;

    await sql`
      CREATE TABLE IF NOT EXISTS time_logs (
        id VARCHAR(64) PRIMARY KEY,
        task_id VARCHAR(64) NOT NULL,
        date VARCHAR(10) NOT NULL,
        minutes INTEGER NOT NULL DEFAULT 0,
        source VARCHAR(20) NOT NULL DEFAULT 'timer',
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        deleted BOOLEAN NOT NULL DEFAULT FALSE,
        is_sample BOOLEAN NOT NULL DEFAULT FALSE,
        server_seq BIGINT NOT NULL DEFAULT nextval('server_seq')
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS days (
        id VARCHAR(10) PRIMARY KEY,
        date VARCHAR(10) NOT NULL,
        free_hours NUMERIC(4,2) DEFAULT 8.0,
        review JSONB DEFAULT '{"worked":"","blocked":"","change":""}'::jsonb,
        sheet_data JSONB DEFAULT '{}'::jsonb,
        updated_at BIGINT NOT NULL,
        deleted BOOLEAN NOT NULL DEFAULT FALSE,
        is_sample BOOLEAN NOT NULL DEFAULT FALSE,
        server_seq BIGINT NOT NULL DEFAULT nextval('server_seq')
      )
    `;
    await sql`
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
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS monthly_plans (
        id VARCHAR(64) PRIMARY KEY,
        month VARCHAR(10) NOT NULL,
        title TEXT NOT NULL,
        prompt TEXT DEFAULT '',
        academic_priorities TEXT DEFAULT '',
        editing_targets TEXT DEFAULT '',
        commitments TEXT DEFAULT '',
        goals JSONB DEFAULT '[]'::jsonb,
        completion_percentage NUMERIC(5,2) DEFAULT 0,
        status VARCHAR(20) DEFAULT 'active',
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        deleted BOOLEAN NOT NULL DEFAULT FALSE,
        server_seq BIGINT NOT NULL DEFAULT nextval('server_seq')
      )
    `;

    // Cloudinary files table for persistent file metadata
    await sql`
      CREATE TABLE IF NOT EXISTS files (
        id VARCHAR(64) PRIMARY KEY,
        public_id TEXT NOT NULL,
        secure_url TEXT NOT NULL,
        original_filename TEXT NOT NULL,
        resource_type VARCHAR(20) NOT NULL,
        format VARCHAR(20) DEFAULT '',
        file_size BIGINT NOT NULL,
        user_id VARCHAR(64) NOT NULL DEFAULT 'owner',
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        deleted BOOLEAN NOT NULL DEFAULT FALSE,
        mime_type VARCHAR(100),
        width INTEGER,
        height INTEGER,
        duration NUMERIC(10,2),
        tags JSONB DEFAULT '[]'::jsonb,
        server_seq BIGINT NOT NULL DEFAULT nextval('server_seq')
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_files_user_id ON files(user_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_files_public_id ON files(public_id)`;

    // AI Conversations table for cross-device sync & permanent history
    await sql`
      CREATE TABLE IF NOT EXISTS ai_conversations (
        id VARCHAR(128) PRIMARY KEY,
        assistant VARCHAR(32) NOT NULL DEFAULT 'sams_ai',
        title TEXT NOT NULL,
        user_id VARCHAR(64) NOT NULL DEFAULT 'owner',
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        data JSONB DEFAULT '{}'::jsonb
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_ai_conversations_assistant ON ai_conversations(assistant, user_id)`;

    // AI Messages table for persistent cross-device history
    await sql`
      CREATE TABLE IF NOT EXISTS ai_messages (
        id VARCHAR(128) PRIMARY KEY,
        conversation_id VARCHAR(128) NOT NULL,
        role VARCHAR(32) NOT NULL,
        content TEXT NOT NULL,
        timestamp BIGINT NOT NULL,
        provider VARCHAR(64),
        actions JSONB DEFAULT '[]'::jsonb,
        user_id VARCHAR(64) NOT NULL DEFAULT 'owner'
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_ai_messages_conv ON ai_messages(conversation_id)`;

    // Ensure all tables have required columns if they were created with earlier schemas
    await sql`ALTER TABLE sections ADD COLUMN IF NOT EXISTS daily_target_minutes INTEGER`;
    await sql`ALTER TABLE sections ADD COLUMN IF NOT EXISTS target_type VARCHAR(20) DEFAULT 'at least'`;
    await sql`ALTER TABLE sections ADD COLUMN IF NOT EXISTS is_sample BOOLEAN DEFAULT FALSE`;

    await sql`ALTER TABLE time_logs ADD COLUMN IF NOT EXISTS is_sample BOOLEAN DEFAULT FALSE`;

    await sql`ALTER TABLE days ADD COLUMN IF NOT EXISTS free_hours NUMERIC(4,2) DEFAULT 8.0`;
    await sql`ALTER TABLE days ADD COLUMN IF NOT EXISTS review JSONB DEFAULT '{"worked":"","blocked":"","change":""}'::jsonb`;
    await sql`ALTER TABLE days ADD COLUMN IF NOT EXISTS sheet_data JSONB DEFAULT '{}'::jsonb`;
    await sql`ALTER TABLE days ADD COLUMN IF NOT EXISTS is_sample BOOLEAN DEFAULT FALSE`;

    await sql`ALTER TABLE weekly_plans ADD COLUMN IF NOT EXISTS ai_weekly_report TEXT`;
    await sql`ALTER TABLE weekly_plans ADD COLUMN IF NOT EXISTS word_count INTEGER DEFAULT 0`;
    await sql`ALTER TABLE weekly_plans ADD COLUMN IF NOT EXISTS completion_percentage NUMERIC(5,2) DEFAULT 0`;

    await sql`ALTER TABLE monthly_plans ADD COLUMN IF NOT EXISTS commitments TEXT DEFAULT ''`;
    await sql`ALTER TABLE monthly_plans ADD COLUMN IF NOT EXISTS deliverables TEXT DEFAULT ''`;
    await sql`ALTER TABLE monthly_plans ADD COLUMN IF NOT EXISTS completion_percentage NUMERIC(5,2) DEFAULT 0`;

    schemaInitialized = true;
  } catch (err: any) {
    console.warn('ensureSchema warning:', err.message);
  }
}

/**
 * Server-side batch upsert with "newest updatedAt wins" conflict resolution
 */
export async function syncBatch(
  sql: any,
  incoming: {
    sections: Section[];
    tasks: Task[];
    timeLogs: TimeLog[];
    days: Day[];
    weeklyPlans?: WeeklyPlan[];
    monthlyPlans?: MonthlyPlan[];
    lastServerSeq: number;
  }
) {
  await ensureSchema(sql);

  const ack = {
    sections: [] as string[],
    tasks: [] as string[],
    timeLogs: [] as string[],
    days: [] as string[],
    weeklyPlans: [] as string[],
    monthlyPlans: [] as string[],
  };

  // Upsert Sections
  for (const s of incoming.sections) {
    await sql`
      INSERT INTO sections (id, name, color, icon, "order", daily_target_minutes, target_type, updated_at, deleted, is_sample, server_seq)
      VALUES (${s.id}, ${s.name}, ${s.color}, ${s.icon}, ${s.order}, ${s.dailyTargetMinutes ?? null}, ${s.targetType}, ${s.updatedAt}, ${s.deleted}, ${s.isSample}, nextval('server_seq'))
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        color = EXCLUDED.color,
        icon = EXCLUDED.icon,
        "order" = EXCLUDED."order",
        daily_target_minutes = EXCLUDED.daily_target_minutes,
        target_type = EXCLUDED.target_type,
        updated_at = EXCLUDED.updated_at,
        deleted = EXCLUDED.deleted,
        is_sample = EXCLUDED.is_sample,
        server_seq = nextval('server_seq')
      WHERE EXCLUDED.updated_at >= sections.updated_at
    `;
    ack.sections.push(s.id);
  }

  // Upsert Tasks
  for (const t of incoming.tasks) {
    const tagsJson = JSON.stringify(t.tags || []);
    await sql`
      INSERT INTO tasks (
        id, date, section_id, title, description, strategy, done_means,
        estimated_minutes, priority, must_do, tags, icon, text_color, image,
        is_completed, completed_at, "order", created_at, updated_at, deleted, is_sample,
        start_time, end_time, scheduled_minutes, actual_minutes, status, deadline, result,
        is_bold, is_underline, is_strikethrough, target_minutes, expected_completion_time,
        server_seq
      )
      VALUES (
        ${t.id}, ${t.date}, ${t.sectionId}, ${t.title}, ${t.description || ''}, ${t.strategy || ''}, ${t.doneMeans || ''},
        ${t.estimatedMinutes || 0}, ${t.priority || 'Medium'}, ${t.mustDo || false}, ${tagsJson}::jsonb, ${t.icon || ''},
        ${t.textColor || ''}, ${t.image || null}, ${t.isCompleted || false}, ${t.completedAt ?? null},
        ${t.order || 0}, ${t.createdAt}, ${t.updatedAt}, ${t.deleted}, ${t.isSample},
        ${t.startTime ?? null}, ${t.endTime ?? null}, ${t.scheduledMinutes ?? null}, ${t.actualMinutes ?? null},
        ${t.status || 'not_started'}, ${t.deadline ?? null}, ${t.result ?? null},
        ${t.isBold ?? false}, ${t.isUnderline ?? false}, ${t.isStrikethrough ?? false},
        ${t.targetMinutes ?? null}, ${t.expectedCompletionTime ?? null},
        nextval('server_seq')
      )
      ON CONFLICT (id) DO UPDATE SET
        date = EXCLUDED.date,
        section_id = EXCLUDED.section_id,
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        strategy = EXCLUDED.strategy,
        done_means = EXCLUDED.done_means,
        estimated_minutes = EXCLUDED.estimated_minutes,
        priority = EXCLUDED.priority,
        must_do = EXCLUDED.must_do,
        tags = EXCLUDED.tags,
        icon = EXCLUDED.icon,
        text_color = EXCLUDED.text_color,
        image = EXCLUDED.image,
        is_completed = EXCLUDED.is_completed,
        completed_at = EXCLUDED.completed_at,
        "order" = EXCLUDED."order",
        updated_at = EXCLUDED.updated_at,
        deleted = EXCLUDED.deleted,
        is_sample = EXCLUDED.is_sample,
        start_time = EXCLUDED.start_time,
        end_time = EXCLUDED.end_time,
        scheduled_minutes = EXCLUDED.scheduled_minutes,
        actual_minutes = EXCLUDED.actual_minutes,
        status = EXCLUDED.status,
        deadline = EXCLUDED.deadline,
        result = EXCLUDED.result,
        is_bold = EXCLUDED.is_bold,
        is_underline = EXCLUDED.is_underline,
        is_strikethrough = EXCLUDED.is_strikethrough,
        target_minutes = EXCLUDED.target_minutes,
        expected_completion_time = EXCLUDED.expected_completion_time,
        server_seq = nextval('server_seq')
      WHERE EXCLUDED.updated_at >= tasks.updated_at
    `;
    ack.tasks.push(t.id);
  }

  // Upsert TimeLogs
  for (const tl of incoming.timeLogs) {
    await sql`
      INSERT INTO time_logs (id, task_id, date, minutes, source, created_at, updated_at, deleted, is_sample, server_seq)
      VALUES (${tl.id}, ${tl.taskId}, ${tl.date}, ${tl.minutes}, ${tl.source}, ${tl.createdAt}, ${tl.updatedAt}, ${tl.deleted}, ${tl.isSample}, nextval('server_seq'))
      ON CONFLICT (id) DO UPDATE SET
        minutes = EXCLUDED.minutes,
        source = EXCLUDED.source,
        updated_at = EXCLUDED.updated_at,
        deleted = EXCLUDED.deleted,
        is_sample = EXCLUDED.is_sample,
        server_seq = nextval('server_seq')
      WHERE EXCLUDED.updated_at >= time_logs.updated_at
    `;
    ack.timeLogs.push(tl.id);
  }

  // Upsert Days
  for (const d of incoming.days) {
    const reviewJson = JSON.stringify(d.review || { worked: '', blocked: '', change: '' });
    const sheetDataJson = JSON.stringify(d.sheetData || {});
    await sql`
      INSERT INTO days (id, date, free_hours, review, sheet_data, updated_at, deleted, is_sample, server_seq)
      VALUES (${d.id}, ${d.date}, ${d.freeHours}, ${reviewJson}::jsonb, ${sheetDataJson}::jsonb, ${d.updatedAt}, ${d.deleted}, ${d.isSample}, nextval('server_seq'))
      ON CONFLICT (id) DO UPDATE SET
        free_hours = EXCLUDED.free_hours,
        review = EXCLUDED.review,
        sheet_data = COALESCE(days.sheet_data, '{}'::jsonb) || COALESCE(EXCLUDED.sheet_data, '{}'::jsonb),
        updated_at = EXCLUDED.updated_at,
        deleted = EXCLUDED.deleted,
        is_sample = EXCLUDED.is_sample,
        server_seq = nextval('server_seq')
      WHERE EXCLUDED.updated_at >= days.updated_at
    `;
    ack.days.push(d.id);
  }

  // Upsert Weekly Plans
  if (incoming.weeklyPlans) {
    for (const w of incoming.weeklyPlans) {
      await sql`
        INSERT INTO weekly_plans (
          id, start_date, end_date, month_id, prompt, word_count, goals,
          aastu_commitments, deep_work_targets, constraints, outcomes,
          ai_weekly_report, status, completion_percentage, created_at, updated_at, deleted, server_seq
        )
        VALUES (
          ${w.id}, ${w.startDate}, ${w.endDate}, ${w.monthId}, ${w.prompt}, ${w.wordCount || 0}, ${w.goals || ''},
          ${w.aastuCommitments || ''}, ${w.deepWorkTargets || ''}, ${w.constraints || ''}, ${w.outcomes || ''},
          ${w.aiWeeklyReport || null}, ${w.status || 'active'}, ${w.completionPercentage || 0},
          ${w.createdAt}, ${w.updatedAt}, ${w.deleted}, nextval('server_seq')
        )
        ON CONFLICT (id) DO UPDATE SET
          prompt = EXCLUDED.prompt,
          word_count = EXCLUDED.word_count,
          goals = EXCLUDED.goals,
          aastu_commitments = EXCLUDED.aastu_commitments,
          deep_work_targets = EXCLUDED.deep_work_targets,
          constraints = EXCLUDED.constraints,
          outcomes = EXCLUDED.outcomes,
          ai_weekly_report = EXCLUDED.ai_weekly_report,
          status = EXCLUDED.status,
          completion_percentage = EXCLUDED.completion_percentage,
          updated_at = EXCLUDED.updated_at,
          deleted = EXCLUDED.deleted,
          server_seq = nextval('server_seq')
        WHERE EXCLUDED.updated_at >= weekly_plans.updated_at
      `;
      ack.weeklyPlans.push(w.id);
    }
  }

  // Upsert Monthly Plans
  if (incoming.monthlyPlans) {
    for (const m of incoming.monthlyPlans) {
      const goalsJson = JSON.stringify(m.goals || []);
      await sql`
        INSERT INTO monthly_plans (
          id, month, title, prompt, academic_priorities, editing_targets,
          commitments, goals, completion_percentage, status, created_at, updated_at, deleted, server_seq
        )
        VALUES (
          ${m.id}, ${m.month}, ${m.title}, ${m.prompt || ''}, ${m.academicPriorities || ''},
          ${m.editingTargets || ''}, ${m.commitments || ''}, ${goalsJson}::jsonb,
          ${m.completionPercentage || 0}, ${m.status || 'active'},
          ${m.createdAt}, ${m.updatedAt}, ${m.deleted}, nextval('server_seq')
        )
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          prompt = EXCLUDED.prompt,
          academic_priorities = EXCLUDED.academic_priorities,
          editing_targets = EXCLUDED.editing_targets,
          commitments = EXCLUDED.commitments,
          goals = EXCLUDED.goals,
          completion_percentage = EXCLUDED.completion_percentage,
          status = EXCLUDED.status,
          updated_at = EXCLUDED.updated_at,
          deleted = EXCLUDED.deleted,
          server_seq = nextval('server_seq')
        WHERE EXCLUDED.updated_at >= monthly_plans.updated_at
      `;
      ack.monthlyPlans.push(m.id);
    }
  }

  // Fetch changes newer than client's lastServerSeq
  const clientSeq = incoming.lastServerSeq || 0;

  const [changedSections, changedTasks, changedTimeLogs, changedDays, changedWeekly, changedMonthly, seqRow] = (await Promise.all([
    sql`SELECT * FROM sections WHERE server_seq > ${clientSeq}`,
    sql`SELECT * FROM tasks WHERE server_seq > ${clientSeq}`,
    sql`SELECT * FROM time_logs WHERE server_seq > ${clientSeq}`,
    sql`SELECT * FROM days WHERE server_seq > ${clientSeq}`,
    sql`SELECT * FROM weekly_plans WHERE server_seq > ${clientSeq}`,
    sql`SELECT * FROM monthly_plans WHERE server_seq > ${clientSeq}`,
    sql`SELECT last_value FROM server_seq`,
  ])) as [any[], any[], any[], any[], any[], any[], any[]];

  const currentServerSeq = seqRow && seqRow.length > 0 ? Number(seqRow[0].last_value) : clientSeq;

  // Map server rows back to client model
  const serverSections: Section[] = (changedSections || []).map((r: any) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    icon: r.icon,
    order: Number(r.order),
    dailyTargetMinutes: r.daily_target_minutes !== null ? Number(r.daily_target_minutes) : null,
    targetType: r.target_type,
    updatedAt: Number(r.updated_at),
    deleted: Boolean(r.deleted),
    isSample: Boolean(r.is_sample),
    serverSeq: Number(r.server_seq),
  }));

  const serverTasks: Task[] = (changedTasks || []).map((r: any) => ({
    id: r.id,
    date: r.date,
    sectionId: r.section_id,
    title: r.title,
    description: r.description || '',
    strategy: r.strategy || '',
    doneMeans: r.done_means || '',
    estimatedMinutes: Number(r.estimated_minutes),
    priority: r.priority,
    mustDo: Boolean(r.must_do),
    tags: Array.isArray(r.tags) ? r.tags : (typeof r.tags === 'string' ? JSON.parse(r.tags) : []),
    icon: r.icon || '',
    textColor: r.text_color || '',
    image: r.image || null,
    isCompleted: Boolean(r.is_completed),
    completedAt: r.completed_at ? Number(r.completed_at) : null,
    order: Number(r.order),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    deleted: Boolean(r.deleted),
    isSample: Boolean(r.is_sample),
    serverSeq: Number(r.server_seq),
    startTime: r.start_time || undefined,
    endTime: r.end_time || undefined,
    scheduledMinutes: r.scheduled_minutes ? Number(r.scheduled_minutes) : undefined,
    actualMinutes: r.actual_minutes ? Number(r.actual_minutes) : undefined,
    status: r.status || 'not_started',
    deadline: r.deadline || undefined,
    result: r.result || undefined,
    isBold: Boolean(r.is_bold),
    isUnderline: Boolean(r.is_underline),
    isStrikethrough: Boolean(r.is_strikethrough),
    targetMinutes: r.target_minutes ? Number(r.target_minutes) : undefined,
    expectedCompletionTime: r.expected_completion_time || undefined,
  }));

  const serverTimeLogs: TimeLog[] = (changedTimeLogs || []).map((r: any) => ({
    id: r.id,
    taskId: r.task_id,
    date: r.date,
    minutes: Number(r.minutes),
    source: r.source,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    deleted: Boolean(r.deleted),
    isSample: Boolean(r.is_sample),
    serverSeq: Number(r.server_seq),
  }));

  const serverDays: Day[] = (changedDays || []).map((r: any) => ({
    id: r.id,
    date: r.date,
    freeHours: Number(r.free_hours),
    review: typeof r.review === 'object' && r.review ? r.review : JSON.parse(r.review || '{}'),
    sheetData: typeof r.sheet_data === 'object' && r.sheet_data ? r.sheet_data : JSON.parse(r.sheet_data || '{}'),
    updatedAt: Number(r.updated_at),
    deleted: Boolean(r.deleted),
    isSample: Boolean(r.is_sample),
    serverSeq: Number(r.server_seq),
  }));

  const serverWeekly: WeeklyPlan[] = (changedWeekly || []).map((r: any) => ({
    id: r.id,
    startDate: r.start_date,
    endDate: r.end_date,
    monthId: r.month_id,
    prompt: r.prompt,
    wordCount: Number(r.word_count || 0),
    goals: r.goals || '',
    aastuCommitments: r.aastu_commitments || '',
    deepWorkTargets: r.deep_work_targets || '',
    constraints: r.constraints || '',
    outcomes: r.outcomes || '',
    aiWeeklyReport: r.ai_weekly_report || null,
    status: r.status || 'active',
    completionPercentage: Number(r.completion_percentage || 0),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    deleted: Boolean(r.deleted),
    serverSeq: Number(r.server_seq),
  }));

  const serverMonthly: MonthlyPlan[] = (changedMonthly || []).map((r: any) => ({
    id: r.id,
    month: r.month,
    title: r.title,
    prompt: r.prompt || '',
    academicPriorities: r.academic_priorities || '',
    editingTargets: r.editing_targets || '',
    commitments: r.commitments || r.deliverables || '',
    goals: Array.isArray(r.goals) ? r.goals : (typeof r.goals === 'string' && r.goals ? JSON.parse(r.goals) : []),
    completionPercentage: Number(r.completion_percentage || 0),
    status: r.status || 'active',
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    deleted: Boolean(r.deleted),
    serverSeq: Number(r.server_seq),
  }));

  return {
    currentServerSeq,
    ack,
    serverChanges: {
      sections: serverSections,
      tasks: serverTasks,
      timeLogs: serverTimeLogs,
      days: serverDays,
      weeklyPlans: serverWeekly,
      monthlyPlans: serverMonthly,
    },
  };
}
