export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initScheduler } = await import('@/lib/server/scheduler');
    initScheduler();

    const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
    if (process.env.NODE_ENV === 'production' && webhookSecret) {
      void (async () => {
        const {
          configureTelegramMiniAppMenuButton,
          getTelegramMiniAppUrl,
          setTelegramWebhook,
        } = await import('@/lib/server/telegram');
        const miniAppUrl = new URL(getTelegramMiniAppUrl());
        const setup = await setTelegramWebhook(`${miniAppUrl.origin}/api/telegram/webhook`, webhookSecret);
        if (!setup.ok) throw new Error(setup.description || 'Could not register the Telegram webhook.');
        await configureTelegramMiniAppMenuButton();
        console.info('[Telegram Mini App] Webhook and menu button configured.');
      })().catch(error => {
        console.warn('[Telegram Mini App] Automatic bot setup failed:', error instanceof Error ? error.message : 'Telegram setup failed.');
      });
    }
  }
}
