/**
 * Create participant codes for an experiment (Tandem Studio > Experiments does the same with buttons).
 *   npx tsx scripts/gen-codes.ts --experiment pilot --per-condition 10 [--url https://site/] [--emulator] [--dry-run] > codes.csv
 * Writes codes/{CODE} docs (condition, counterbalancing orderIndex, locked model, agent mode) and prints a CSV with each
 * participant's link. Running it again continues each condition's orderIndex, so extra batches stay counterbalanced.
 * Auth: the service-account key in keys/ (gitignored), or GOOGLE_APPLICATION_CREDENTIALS, or `--emulator`.
 */
import { readFileSync } from 'node:fs';
import { adminDb, defaultSiteUrl, generateCodes, planCodes, toCsv } from './lib/codes';

const args = process.argv.slice(2);
const opt = (k: string, d?: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const flag = (k: string) => args.includes(`--${k}`);
const expId = opt('experiment');
if (!expId) { console.error('Usage: gen-codes --experiment <id> [--per-condition N] [--url https://site/] [--emulator] [--dry-run]'); process.exit(1); }
const exp = JSON.parse(readFileSync(`content/experiments/${expId}.json`, 'utf8'));
const per = Number(opt('per-condition', '10'));
const siteUrl = opt('url', defaultSiteUrl())!;

if (flag('dry-run')) {
  process.stdout.write(toCsv(planCodes(exp, per, siteUrl)));
} else {
  if (flag('emulator')) process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
  const conn = await adminDb();
  if (!conn) { console.error('No service-account key found. Put it in keys/service-account.json (or use Tandem Studio > Experiments > Participant codes).'); process.exit(1); }
  const rows = await generateCodes(conn.db, exp, per, siteUrl);
  process.stdout.write(toCsv(rows));
  console.error(`Wrote ${rows.length} codes for ${exp.id} to ${conn.projectId}${conn.mode === 'emulator' ? ' (emulator)' : ''}`);
}
