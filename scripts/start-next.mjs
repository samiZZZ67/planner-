import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const nextCli = require.resolve('next/dist/bin/next');
const port = process.env.PORT || '3000';

const nextProcess = spawn(
  process.execPath,
  [nextCli, 'start', '--port', port, '--hostname', '0.0.0.0'],
  { stdio: 'inherit' },
);

nextProcess.on('error', (error) => {
  console.error('Could not start the Next.js server:', error);
  process.exitCode = 1;
});

nextProcess.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
