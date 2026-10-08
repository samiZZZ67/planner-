import { neon } from '@neondatabase/serverless';
import type { Section, Task, TimeLog, Day } from '@/types';

export function getDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || databaseUrl.includes('dummy')) {
    return null;
  }
  return neon(databaseUrl);
}

/**
 * Automatically creates tables and sequence if they do not exist
 */
export async function ensureSchema(sql: any): Promise<void> {
  await sql`
    CREATE SEQUENCE IF NOT EXISTS server_seq START WITH 1 INCREMENT BY 1;

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
    );

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
    );

    CREATE TABLE IF NOT EXISTS days (
      id VARCHAR(10) PRIMARY KEY,
      date VARCHAR(10) NOT NULL,
      free_hours NUMERIC(4,2) DEFAULT 8.0,
      review JSONB DEFAULT '{"worked":"","blocked":"","change":""}'::jsonb,
      updated_at BIGINT NOT NULL,
      deleted BOOLEAN NOT NULL DEFAULT FALSE,
      is_sample BOOLEAN NOT NULL DEFAULT FALSE,
      server_seq BIGINT NOT NULL DEFAULT nextval('server_seq')
    );
  `;
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
    lastServerSeq: number;
  }
) {
  await ensureSchema(sql);

  const ack = {
    sections: [] as string[],
    tasks: [] as string[],
    timeLogs: [] as string[],
    days: [] as string[],
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
      INSERT INTO tasks (id, date, section_id, title, description, strategy, done_means, estimated_minutes, priority, must_do, tags, icon, text_color, image, is_completed, completed_at, "order", created_at, updated_at, deleted, is_sample, server_seq)
      VALUES (
        ${t.id}, ${t.date}, ${t.sectionId}, ${t.title}, ${t.description || ''}, ${t.strategy || ''}, ${t.doneMeans || ''},
        ${t.estimatedMinutes || 0}, ${t.priority || 'Medium'}, ${t.mustDo || false}, ${tagsJson}::jsonb, ${t.icon || ''},
        ${t.textColor || ''}, ${t.image || null}, ${t.isCompleted || false}, ${t.completedAt ?? null},
        ${t.order || 0}, ${t.createdAt}, ${t.updatedAt}, ${t.deleted}, ${t.isSample}, nextval('server_seq')
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
    await sql`
      INSERT INTO days (id, date, free_hours, review, updated_at, deleted, is_sample, server_seq)
      VALUES (${d.id}, ${d.date}, ${d.freeHours}, ${reviewJson}::jsonb, ${d.updatedAt}, ${d.deleted}, ${d.isSample}, nextval('server_seq'))
      ON CONFLICT (id) DO UPDATE SET
        free_hours = EXCLUDED.free_hours,
        review = EXCLUDED.review,
        updated_at = EXCLUDED.updated_at,
        deleted = EXCLUDED.deleted,
        is_sample = EXCLUDED.is_sample,
        server_seq = nextval('server_seq')
      WHERE EXCLUDED.updated_at >= days.updated_at
    `;
    ack.days.push(d.id);
  }

  // Fetch changes newer than client's lastServerSeq
  const clientSeq = incoming.lastServerSeq || 0;

  const [changedSections, changedTasks, changedTimeLogs, changedDays, seqRow] = (await Promise.all([
    sql`SELECT * FROM sections WHERE server_seq > ${clientSeq}`,
    sql`SELECT * FROM tasks WHERE server_seq > ${clientSeq}`,
    sql`SELECT * FROM time_logs WHERE server_seq > ${clientSeq}`,
    sql`SELECT * FROM days WHERE server_seq > ${clientSeq}`,
    sql`SELECT last_value FROM server_seq`,
  ])) as [any[], any[], any[], any[], any[]];

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
    updatedAt: Number(r.updated_at),
    deleted: Boolean(r.deleted),
    isSample: Boolean(r.is_sample),
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
    },
  };
}
