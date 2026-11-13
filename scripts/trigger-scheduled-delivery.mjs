const appUrl = process.env.MOON_APP_URL?.trim().replace(/\/+$/, '');
const cronSecret = process.env.BOOKS_CRON_SECRET?.trim();

if (!appUrl || !cronSecret) {
  console.error('MOON_APP_URL and BOOKS_CRON_SECRET must both be configured.');
  process.exit(1);
}

let baseUrl;
try {
  baseUrl = new URL(appUrl);
} catch {
  console.error('MOON_APP_URL must be a valid absolute URL.');
  process.exit(1);
}

if (baseUrl.protocol !== 'https:' && baseUrl.hostname !== 'localhost' && baseUrl.hostname !== '127.0.0.1') {
  console.error('MOON_APP_URL must use HTTPS outside localhost.');
  process.exit(1);
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function wakeService() {
  let lastStatus = 'no response';
  for (let attempt = 1; attempt <= 4; attempt++) {
    for (const path of ['/health', '/api/health']) {
      try {
        const response = await fetch(`${appUrl}${path}`, {
          method: 'GET',
          signal: AbortSignal.timeout(45_000),
          cache: 'no-store',
        });
        lastStatus = `${path} returned HTTP ${response.status}`;
        if (response.ok) {
          await response.body?.cancel();
          return;
        }
        await response.body?.cancel();
      } catch (error) {
        lastStatus = `${path} failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    if (attempt < 4) await sleep(attempt * 5_000);
  }
  throw new Error(`Could not wake the app after 4 attempts (${lastStatus}).`);
}

try {
  console.log(`Waking ${appUrl} before requesting delivery.`);
  await wakeService();
  await sleep(5_000);

  // Do not retry this POST automatically: a network timeout can occur after
  // Telegram accepted a message, and retrying could create a duplicate.
  const response = await fetch(`${appUrl}/api/cron/books`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${cronSecret}`,
      'content-type': 'application/json',
    },
    signal: AbortSignal.timeout(300_000),
    cache: 'no-store',
  });
  const body = await response.text();
  let result;
  try {
    result = JSON.parse(body);
  } catch {
    throw new Error(`Delivery endpoint returned HTTP ${response.status} with invalid JSON: ${body.slice(0, 500)}`);
  }

  console.log(JSON.stringify(result, null, 2));
  if (!response.ok || result.ok !== true) {
    throw new Error(`Delivery cycle failed with HTTP ${response.status}.`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
