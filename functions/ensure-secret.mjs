// The emulator needs a value for the OPENAI_API_KEY secret; the mock upstream ignores it.
import { existsSync, writeFileSync } from 'node:fs';
if (!existsSync('.secret.local')) writeFileSync('.secret.local', 'OPENAI_API_KEY=sk-emulator-placeholder\n');
