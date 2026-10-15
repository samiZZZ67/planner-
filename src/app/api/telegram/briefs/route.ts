import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server/auth';
import {
  getBriefStatus,
  saveBriefConfig,
  sendBriefNow,
  generateEnrichedBriefContent,
  getLocalTodayDate,
  type BriefType,
} from '@/lib/server/scheduler/briefs';
import { checkTelegramChannel } from '@/lib/server/telegram';

export async function GET(request: Request) {
  const session = await getSessionUser(request);
  if (!session) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  try {
    const status = await getBriefStatus(session.userId);
    const channelStatus = await checkTelegramChannel().catch(err => ({
      configured: false,
      connected: false,
      canPost: false,
      message: err?.message || 'Telegram not reachable',
    }));

    const today = getLocalTodayDate(status.config.timezone);
    const [morningPreview, eveningPreview] = await Promise.all([
      generateEnrichedBriefContent('morning', today, session.userId, status.config.temporaryMorningContent).catch(err => `Could not generate preview: ${err.message}`),
      generateEnrichedBriefContent('evening', today, session.userId, status.config.temporaryEveningContent).catch(err => `Could not generate preview: ${err.message}`),
    ]);

    return NextResponse.json({
      ok: true,
      status,
      channel: channelStatus,
      previews: {
        morning: morningPreview,
        evening: eveningPreview,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to fetch brief scheduling status.' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const session = await getSessionUser(request);
  if (!session) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const action = body.action;

    if (action === 'send_now') {
      const briefType: BriefType = body.briefType === 'evening' ? 'evening' : 'morning';
      const customOverride = typeof body.overrideContent === 'string' ? body.overrideContent : undefined;
      const res = await sendBriefNow(session.userId, briefType, customOverride);
      return NextResponse.json({
        ok: true,
        briefType,
        record: res.record,
        channel: res.channel,
        message: `${briefType === 'morning' ? 'Morning Brief' : 'Evening Review'} delivered to Telegram!`,
      });
    }

    if (action === 'update_config') {
      const updatePayload: any = { userId: session.userId };
      if (typeof body.enabled === 'boolean') updatePayload.enabled = body.enabled;
      if (typeof body.morningTime === 'string') updatePayload.morningTime = body.morningTime;
      if (typeof body.eveningTime === 'string') updatePayload.eveningTime = body.eveningTime;
      if (typeof body.timezone === 'string') updatePayload.timezone = body.timezone;

      const saved = await saveBriefConfig(updatePayload);
      const updatedStatus = await getBriefStatus(session.userId);
      return NextResponse.json({
        ok: true,
        config: saved,
        status: updatedStatus,
        message: 'Brief schedule configuration saved successfully.',
      });
    }

    if (action === 'override') {
      const briefType: BriefType = body.briefType === 'evening' ? 'evening' : 'morning';
      const updatePayload: any = { userId: session.userId };

      if (body.skipNext) {
        const today = getLocalTodayDate(body.timezone || 'Africa/Addis_Ababa');
        if (briefType === 'morning') updatePayload.skipNextMorningDate = today;
        else updatePayload.skipNextEveningDate = today;
      }

      if (body.unskip) {
        if (briefType === 'morning') updatePayload.skipNextMorningDate = null;
        else updatePayload.skipNextEveningDate = null;
      }

      if (body.overrideTime) {
        const today = getLocalTodayDate(body.timezone || 'Africa/Addis_Ababa');
        if (briefType === 'morning') {
          updatePayload.overrideMorningDate = body.overrideDate || today;
          updatePayload.overrideMorningTime = body.overrideTime;
        } else {
          updatePayload.overrideEveningDate = body.overrideDate || today;
          updatePayload.overrideEveningTime = body.overrideTime;
        }
      }

      if (body.clearTimeOverride) {
        if (briefType === 'morning') {
          updatePayload.overrideMorningDate = null;
          updatePayload.overrideMorningTime = null;
        } else {
          updatePayload.overrideEveningDate = null;
          updatePayload.overrideEveningTime = null;
        }
      }

      if (typeof body.temporaryContent === 'string') {
        if (briefType === 'morning') updatePayload.temporaryMorningContent = body.temporaryContent;
        else updatePayload.temporaryEveningContent = body.temporaryContent;
      }

      if (body.clearTemporaryContent) {
        if (briefType === 'morning') updatePayload.temporaryMorningContent = null;
        else updatePayload.temporaryEveningContent = null;
      }

      const saved = await saveBriefConfig(updatePayload);
      const updatedStatus = await getBriefStatus(session.userId);
      return NextResponse.json({
        ok: true,
        config: saved,
        status: updatedStatus,
        message: 'Scheduled override saved.',
      });
    }

    return NextResponse.json(
      { error: 'Invalid action. Supported actions: send_now, update_config, override.' },
      { status: 400 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to process brief action.' },
      { status: 500 }
    );
  }
}
