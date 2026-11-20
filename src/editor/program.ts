/** Single place that answers "what program would Run execute right now?" */
import { currentWorkspace } from '../store';
import { stepsToJs, workspaceJsonToSteps } from '../blocks/steps';

let generatedFromBlocks: string | null = null;
export const setGeneratedJs = (js: string) => { generatedFromBlocks = js; };
export function programSource(): string {
  const ws = currentWorkspace();
  if (!ws) return '';
  if (ws.editor === 'code') return ws.code;
  return generatedFromBlocks ?? stepsToJs(workspaceJsonToSteps(ws.blocks));
}
export const resetGenerated = () => { generatedFromBlocks = null; };
