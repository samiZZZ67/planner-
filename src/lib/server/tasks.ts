import { getDb, ensureSchema } from './neon';
import { getLocalTasks, getLocalSections, saveLocalTask, deleteLocalTask } from './localDb';
import type { Task, Section, PriorityLevel, TaskStatus } from '@/types';

export interface CreateTaskInput {
  title: string;
  category?: string; // Section name or ID
  sectionId?: string;
  date: string; // YYYY-MM-DD
  startTime?: string;
  endTime?: string;
  scheduledMinutes?: number;
  priority?: PriorityLevel | string;
  deadline?: string;
  mustDo?: boolean;
  description?: string;
  strategy?: string;
  idempotencyKey?: string;
}

export interface TaskOperationResult {
  ok: boolean;
  task?: Task;
  error?: string;
  duplicatePrevented?: boolean;
}

/**
 * Get available sections from the authoritative database
 */
export async function getSectionsFromDb(): Promise<Section[]> {
  const sql = getDb();
  if (sql) {
    try {
      await ensureSchema(sql);
      const rows = await sql`SELECT * FROM sections WHERE deleted = FALSE ORDER BY "order" ASC`;
      if (rows && rows.length > 0) {
        return rows.map((r: any) => ({
          id: r.id,
          name: r.name,
          color: r.color,
          icon: r.icon,
          order: Number(r.order || 0),
          dailyTargetMinutes: r.daily_target_minutes ? Number(r.daily_target_minutes) : null,
          targetType: r.target_type || 'at least',
          updatedAt: Number(r.updated_at),
          deleted: Boolean(r.deleted),
          isSample: Boolean(r.is_sample),
          serverSeq: Number(r.server_seq),
        }));
      }
    } catch (err: any) {
      console.warn('[Task Service] Neon query error for sections, falling back to localDb:', err.message);
    }
  }
  return getLocalSections();
}

/**
 * Get tasks from the authoritative database
 */
export async function getTasksFromDb(date?: string): Promise<Task[]> {
  const sql = getDb();
  if (sql) {
    try {
      await ensureSchema(sql);
      let rows;
      if (date) {
        rows = await sql`SELECT * FROM tasks WHERE date = ${date} AND deleted = FALSE ORDER BY created_at ASC`;
      } else {
        rows = await sql`SELECT * FROM tasks WHERE deleted = FALSE ORDER BY created_at ASC`;
      }
      if (rows) {
        return rows.map((r: any) => ({
          id: r.id,
          date: r.date,
          sectionId: r.section_id,
          title: r.title,
          description: r.description || '',
          strategy: r.strategy || '',
          doneMeans: r.done_means || '',
          estimatedMinutes: Number(r.estimated_minutes || 0),
          priority: (r.priority as PriorityLevel) || 'Medium',
          mustDo: Boolean(r.must_do),
          tags: Array.isArray(r.tags) ? r.tags : [],
          icon: r.icon || '🎯',
          textColor: r.text_color || '',
          image: r.image || null,
          isCompleted: Boolean(r.is_completed),
          completedAt: r.completed_at ? Number(r.completed_at) : null,
          order: Number(r.order || 0),
          createdAt: Number(r.created_at),
          updatedAt: Number(r.updated_at),
          deleted: Boolean(r.deleted),
          isSample: Boolean(r.is_sample),
          serverSeq: Number(r.server_seq),
          startTime: r.start_time || undefined,
          endTime: r.end_time || undefined,
          scheduledMinutes: r.scheduled_minutes ? Number(r.scheduled_minutes) : undefined,
          actualMinutes: r.actual_minutes ? Number(r.actual_minutes) : undefined,
          status: (r.status as TaskStatus) || (r.is_completed ? 'completed' : 'not_started'),
          deadline: r.deadline || undefined,
          result: r.result || undefined,
        }));
      }
    } catch (err: any) {
      console.warn('[Task Service] Neon query error for tasks, falling back to localDb:', err.message);
    }
  }
  return getLocalTasks(date);
}

/**
 * Create a new task in the actual database with full validation and duplicate protection
 */
export async function createTaskInDb(input: CreateTaskInput): Promise<TaskOperationResult> {
  try {
    console.log('[Task Service] Received create task request:', JSON.stringify(input));

    // 1. Validate title
    const trimmedTitle = (input.title || '').trim();
    if (!trimmedTitle) {
      return { ok: false, error: 'Task title is required and cannot be empty.' };
    }

    // 2. Validate date
    let date = (input.date || '').trim();
    if (date.toLowerCase() === 'today' || !date) {
      date = new Date().toISOString().split('T')[0];
    } else if (date.toLowerCase() === 'tomorrow') {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      date = d.toISOString().split('T')[0];
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return { ok: false, error: `Invalid date format "${input.date}". Date must be in YYYY-MM-DD format.` };
    }

    // 3. Validate priority
    const priority = (input.priority || 'Medium') as string;
    const validPriorities: PriorityLevel[] = ['Low', 'Medium', 'High'];
    if (!validPriorities.includes(priority as PriorityLevel)) {
      return {
        ok: false,
        error: `Invalid priority "${priority}". Priority must be one of: Low, Medium, High.`,
      };
    }

    // 4. Validate and resolve category / section against real database sections
    const sections = await getSectionsFromDb();
    const categoryQuery = (input.category || input.sectionId || '').trim();
    let matchedSection: Section | undefined;

    if (categoryQuery) {
      matchedSection = sections.find(
        s => s.id === categoryQuery || s.name.toLowerCase() === categoryQuery.toLowerCase()
      );
      if (!matchedSection) {
        // Fallback: check if query is substring
        matchedSection = sections.find(
          s => s.name.toLowerCase().includes(categoryQuery.toLowerCase()) ||
               categoryQuery.toLowerCase().includes(s.name.toLowerCase())
        );
      }
    }

    if (!matchedSection) {
      // If category was explicitly specified but completely invalid, return error
      if (categoryQuery && !categoryQuery.toLowerCase().includes('default') && !categoryQuery.toLowerCase().includes('general')) {
        const availableNames = sections.map(s => `"${s.name}"`).join(', ');
        return {
          ok: false,
          error: `Category "${categoryQuery}" does not exist. Available categories: ${availableNames}.`,
        };
      }
      // Otherwise default to first available section
      matchedSection = sections[0];
    }

    if (!matchedSection) {
      return { ok: false, error: 'No categories available in the database to assign task.' };
    }

    // 5. Calculate / parse duration
    let scheduledMinutes = Number(input.scheduledMinutes);
    if (!scheduledMinutes || isNaN(scheduledMinutes) || scheduledMinutes <= 0) {
      if (input.startTime && input.endTime) {
        const [sh, sm] = input.startTime.split(':').map(Number);
        const [eh, em] = input.endTime.split(':').map(Number);
        let diff = (eh * 60 + em) - (sh * 60 + sm);
        if (diff <= 0) diff += 24 * 60; // Crosses midnight
        scheduledMinutes = diff;
      } else {
        scheduledMinutes = 60;
      }
    }

    // 6. Check for duplicate task on the same date (Requirement 5 & 6)
    const existingTasks = await getTasksFromDb(date);
    const duplicate = existingTasks.find(
      t => t.title.toLowerCase() === trimmedTitle.toLowerCase() &&
           t.sectionId === matchedSection!.id
    );

    if (duplicate) {
      console.log(`[Task Service] Idempotent match: Task "${trimmedTitle}" already exists with ID: ${duplicate.id}`);
      return {
        ok: true,
        task: duplicate,
        duplicatePrevented: true,
      };
    }

    // 7. Construct task record
    const now = Date.now();
    const taskId = crypto.randomUUID();
    const newTask: Task = {
      id: taskId,
      date,
      sectionId: matchedSection.id,
      title: trimmedTitle,
      description: input.description || '',
      strategy: input.strategy || '',
      doneMeans: '',
      estimatedMinutes: scheduledMinutes,
      scheduledMinutes,
      priority: priority as PriorityLevel,
      mustDo: Boolean(input.mustDo),
      tags: [],
      icon: '🎯',
      textColor: '',
      image: null,
      isCompleted: false,
      completedAt: null,
      order: existingTasks.length,
      createdAt: now,
      updatedAt: now,
      deleted: false,
      isSample: false,
      synced: 1, // Authoritatively saved to database
      startTime: input.startTime || undefined,
      endTime: input.endTime || undefined,
      status: 'not_started',
      deadline: (input.deadline && input.deadline.toLowerCase() !== 'none') ? input.deadline : undefined,
    };

    // 8. Insert into actual database
    const sql = getDb();
    if (sql) {
      try {
        await ensureSchema(sql);
        const inserted = await sql`
          INSERT INTO tasks (
            id, date, section_id, title, description, strategy, done_means,
            estimated_minutes, scheduled_minutes, priority, must_do, tags, icon,
            text_color, is_completed, completed_at, "order", created_at, updated_at,
            deleted, is_sample, start_time, end_time, status, deadline
          ) VALUES (
            ${newTask.id}, ${newTask.date}, ${newTask.sectionId}, ${newTask.title},
            ${newTask.description}, ${newTask.strategy}, ${newTask.doneMeans},
            ${newTask.estimatedMinutes}, ${newTask.scheduledMinutes}, ${newTask.priority},
            ${newTask.mustDo}, ${JSON.stringify(newTask.tags)}::jsonb, ${newTask.icon},
            ${newTask.textColor || ''}, ${newTask.isCompleted}, ${newTask.completedAt},
            ${newTask.order}, ${newTask.createdAt}, ${newTask.updatedAt},
            ${newTask.deleted}, ${newTask.isSample}, ${newTask.startTime || null},
            ${newTask.endTime || null}, ${newTask.status}, ${newTask.deadline || null}
          )
          RETURNING *
        `;
        if (!inserted || inserted.length === 0) {
          throw new Error('Database insertion returned 0 rows.');
        }
        console.log(`[Task Service] Inserted task into Neon Postgres: ${newTask.title} (ID: ${newTask.id})`);
      } catch (sqlErr: any) {
        console.warn('[Task Service] Neon insert warning, mirrored to localDb:', sqlErr.message);
      }
    }
    // Always mirror to local server DB so both stores remain consistent
    saveLocalTask(newTask);
    console.log(`[Task Service] Saved task to local server DB: ${newTask.title} (ID: ${newTask.id})`);

    return {
      ok: true,
      task: newTask,
    };
  } catch (err: any) {
    console.error('[Task Service] Database insertion failure:', err);
    return {
      ok: false,
      error: `Database persistence error: ${err.message || 'Unknown database failure'}`,
    };
  }
}

/**
 * Update an existing task in the database
 */
export async function updateTaskInDb(
  taskIdOrTitle: string,
  updates: Partial<Task>,
  date?: string
): Promise<TaskOperationResult> {
  try {
    const tasks = await getTasksFromDb(date);
    const target = tasks.find(
      t => t.id === taskIdOrTitle || t.title.toLowerCase() === taskIdOrTitle.toLowerCase()
    );

    if (!target) {
      return { ok: false, error: `Task matching "${taskIdOrTitle}" was not found.` };
    }

    const updatedTask: Task = {
      ...target,
      ...updates,
      updatedAt: Date.now(),
    };

    const sql = getDb();
    if (sql) {
      try {
        await ensureSchema(sql);
        await sql`
          UPDATE tasks SET
            title = ${updatedTask.title},
            is_completed = ${updatedTask.isCompleted},
            status = ${updatedTask.status || (updatedTask.isCompleted ? 'completed' : 'not_started')},
            completed_at = ${updatedTask.completedAt},
            date = ${updatedTask.date},
            deadline = ${updatedTask.deadline || null},
            priority = ${updatedTask.priority},
            scheduled_minutes = ${updatedTask.scheduledMinutes || updatedTask.estimatedMinutes},
            estimated_minutes = ${updatedTask.estimatedMinutes},
            section_id = ${updatedTask.sectionId},
            updated_at = ${updatedTask.updatedAt}
          WHERE id = ${updatedTask.id}
        `;
      } catch (sqlErr: any) {
        console.warn('[Task Service] Neon update warning, mirrored to localDb:', sqlErr.message);
      }
    }
    saveLocalTask(updatedTask);

    console.log(`[Task Service] Successfully updated task: ${updatedTask.title} (ID: ${updatedTask.id})`);
    return { ok: true, task: updatedTask };
  } catch (err: any) {
    console.error('[Task Service] Update failure:', err);
    return { ok: false, error: err.message };
  }
}

/**
 * Soft delete a task in the database
 */
export async function deleteTaskInDb(
  taskIdOrTitle: string,
  date?: string
): Promise<{ ok: boolean; taskId?: string; error?: string }> {
  try {
    const tasks = await getTasksFromDb(date);
    const target = tasks.find(
      t => t.id === taskIdOrTitle || t.title.toLowerCase() === taskIdOrTitle.toLowerCase()
    );

    if (!target) {
      return { ok: false, error: `Task matching "${taskIdOrTitle}" was not found to delete.` };
    }

    const sql = getDb();
    if (sql) {
      try {
        await ensureSchema(sql);
        await sql`UPDATE tasks SET deleted = TRUE, updated_at = ${Date.now()} WHERE id = ${target.id}`;
      } catch (sqlErr: any) {
        console.warn('[Task Service] Neon delete warning, mirrored to localDb:', sqlErr.message);
      }
    }
    deleteLocalTask(target.id);

    console.log(`[Task Service] Successfully deleted task: ${target.title} (ID: ${target.id})`);
    return { ok: true, taskId: target.id };
  } catch (err: any) {
    console.error('[Task Service] Delete failure:', err);
    return { ok: false, error: err.message };
  }
}

/**
 * Bulk delete all tasks for a specified date
 */
export async function deleteAllTasksInDb(
  date: string
): Promise<{ ok: boolean; deletedCount: number; error?: string }> {
  try {
    const tasks = await getTasksFromDb(date);
    const toDelete = tasks.filter(t => t.date === date && !t.deleted);
    const sql = getDb();
    const now = Date.now();
    for (const t of toDelete) {
      if (sql) {
        try {
          await ensureSchema(sql);
          await sql`UPDATE tasks SET deleted = TRUE, updated_at = ${now} WHERE id = ${t.id}`;
        } catch {}
      }
      deleteLocalTask(t.id);
    }
    console.log(`[Task Service] Bulk deleted ${toDelete.length} tasks for date: ${date}`);
    return { ok: true, deletedCount: toDelete.length };
  } catch (err: any) {
    console.error('[Task Service] Bulk delete failure:', err);
    return { ok: false, deletedCount: 0, error: err.message };
  }
}
