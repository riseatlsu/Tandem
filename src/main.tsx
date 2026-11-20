import { createRoot } from 'react-dom/client';
import './ui/theme.css';
import { App } from './App';

// No StrictMode: effects here own imperative resources (WebGL, Blockly, workers) and one-shot study redemption.
createRoot(document.getElementById('root')!).render(<App />);

if (import.meta.env.DEV || import.meta.env.VITE_E2E === 'true') {
  void Promise.all([import('./store'), import('./simHost'), import('./editor/program'), import('./blocks/steps'), import('./study/logger')]).then(([store, sh, prog, steps, logger]) => {
    const w = window as unknown as Record<string, unknown>;
    w.__tandem = { useApp: store.useApp, host: sh.host, programSource: prog.programSource, updateWorkspace: store.updateWorkspace, flushLogs: logger.flush };
    w.__tandemSetSteps = (s: Parameters<typeof steps.stepsToWorkspaceJson>[0]) => store.updateWorkspace({ blocks: { ...steps.stepsToWorkspaceJson(s), __external: true } });
  });
}
