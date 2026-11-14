import { existsSync, renameSync } from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const nextSourceApp = path.join(projectRoot, 'src', 'app');
const conflictingApp = path.join(projectRoot, 'app');
const preservedFlutterTemplate = path.join(projectRoot, 'flutter_template');

if (!existsSync(nextSourceApp) || !existsSync(conflictingApp)) {
  process.exit(0);
}

if (!existsSync(path.join(conflictingApp, 'pubspec.yaml'))) {
  throw new Error(
    'A root app/ directory conflicts with src/app/, but it is not a Flutter project. Resolve the Next.js app directory conflict before starting.',
  );
}

if (existsSync(preservedFlutterTemplate)) {
  throw new Error(
    'Both the root app/ directory and flutter_template/ exist. Resolve the folder conflict before starting Next.js.',
  );
}

try {
  renameSync(conflictingApp, preservedFlutterTemplate);
  console.log('Moved the unused root Flutter starter from app/ to flutter_template/ so Next.js can use src/app/.');
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  throw new Error(
    `Could not move the root Flutter starter out of Next.js app discovery. Close tools using app/ and retry. ${detail}`,
  );
}
