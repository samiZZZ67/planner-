import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/server/auth';
import {
  createTaskInDb,
  updateTaskInDb,
  deleteTaskInDb,
  getTasksFromDb,
} from '@/lib/server/tasks';

export async function GET(req: NextRequest) {
  try {
    const isAuth = await verifySession(req);
    if (!isAuth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const date = searchParams.get('date') || undefined;

    const tasks = await getTasksFromDb(date);
    return NextResponse.json({ ok: true, tasks });
  } catch (err: any) {
    console.error('[API /api/tasks GET] Error:', err);
    return NextResponse.json({ error: err.message || 'Failed to fetch tasks' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const isAuth = await verifySession(req);
    if (!isAuth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const action = body.action || 'create';

    if (action === 'create') {
      const result = await createTaskInDb(body);
      if (!result.ok) {
        return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
      }
      return NextResponse.json({ ok: true, task: result.task, duplicatePrevented: result.duplicatePrevented });
    }

    if (action === 'update') {
      const taskId = body.taskId || body.taskIdentifier;
      if (!taskId) {
        return NextResponse.json({ ok: false, error: 'taskId is required' }, { status: 400 });
      }
      const result = await updateTaskInDb(taskId, body.updates || {}, body.date);
      if (!result.ok) {
        return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
      }
      return NextResponse.json({ ok: true, task: result.task });
    }

    if (action === 'delete') {
      const taskId = body.taskId || body.taskIdentifier;
      if (!taskId) {
        return NextResponse.json({ ok: false, error: 'taskId is required' }, { status: 400 });
      }
      const result = await deleteTaskInDb(taskId, body.date);
      if (!result.ok) {
        return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
      }
      return NextResponse.json({ ok: true, taskId: result.taskId });
    }

    return NextResponse.json({ error: `Unknown action "${action}"` }, { status: 400 });
  } catch (err: any) {
    console.error('[API /api/tasks POST] Error:', err);
    return NextResponse.json({ error: err.message || 'Task operation failed' }, { status: 500 });
  }
}
