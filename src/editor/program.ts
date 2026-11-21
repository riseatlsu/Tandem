/** Single place that answers "what program would Run execute right now?" */
import { currentWorkspace } from '../store';
import { lanesToJs, stepsToJs, workspaceJsonToLanes, workspaceJsonToSteps } from '../blocks/steps';
import type { ProgramSource } from '../runtime/headless';

let generatedFromBlocks: ProgramSource | null = null;
/** The blocks editor reports its generated JS: a string, or one program per arm in multi-arm tasks. */
export const setGeneratedJs = (js: ProgramSource) => { generatedFromBlocks = js; };
export function programSource(): ProgramSource {
  const ws = currentWorkspace();
  if (!ws) return '';
  if (ws.lanes) {
    if (ws.editor === 'code') return Object.fromEntries(Object.entries(ws.lanes).map(([r, l]) => [r, l.code]));
    if (generatedFromBlocks && typeof generatedFromBlocks !== 'string') return generatedFromBlocks;
    return lanesToJs(workspaceJsonToLanes(ws.blocks));
  }
  if (ws.editor === 'code') return ws.code;
  if (typeof generatedFromBlocks === 'string') return generatedFromBlocks;
  return stepsToJs(workspaceJsonToSteps(ws.blocks));
}
/** Program text for display, hashing and plan checks (multi-arm programs are joined with lane headers). */
export function programText(src: ProgramSource = programSource()): string {
  return typeof src === 'string' ? src : Object.entries(src).map(([r, c]) => `// ---- arm ${r}\n${c}`).join('\n');
}
export const resetGenerated = () => { generatedFromBlocks = null; };
