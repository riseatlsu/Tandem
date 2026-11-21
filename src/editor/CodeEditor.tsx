import { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor';
import { ROBOT_API_DTS } from './robotApiDts';
import { useApp, updateLane, updateWorkspace, type Workspace } from '../store';
import { logEvent } from '../study/logger';

let configured = false;
function configure() {
  if (configured) return;
  configured = true;
  const ts = monaco.typescript;
  ts.javascriptDefaults.setCompilerOptions({ target: ts.ScriptTarget.ES2020, allowNonTsExtensions: true, checkJs: true, noLib: false, lib: ['es2020'], module: ts.ModuleKind.ESNext });
  ts.javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false, diagnosticCodesToIgnore: [1375, 1378, 80001, 80005, 7044, 1108] });
  ts.javascriptDefaults.addExtraLib(ROBOT_API_DTS, 'ts:robot-api.d.ts');
  monaco.editor.defineTheme('tandem', {
    base: 'vs', inherit: true,
    rules: [
      { token: 'comment', foreground: '7c8ea6', fontStyle: 'italic' },
      { token: 'keyword', foreground: '1a6fd6', fontStyle: 'bold' },
      { token: 'string', foreground: '1f9a3c' },
      { token: 'number', foreground: 'c2410c' },
      { token: 'identifier', foreground: '0d2240' },
    ],
    colors: {
      'editor.background': '#fbfdff', 'editor.lineHighlightBackground': '#eef6ff', 'editorLineNumber.foreground': '#a7b6c8',
      'editorLineNumber.activeForeground': '#1a8cff', 'editor.selectionBackground': '#cfe6ff', 'editorCursor.foreground': '#1a8cff',
      'editorIndentGuide.background1': '#e5edf6', 'editorWidget.background': '#ffffff', 'editorGutter.background': '#f6faff',
    },
  });
}

/** Stable empty value: a store selector must not return a new object on every call. */
const NO_HIGHLIGHT: { line?: number; blockId?: string } = {};
const codeOf = (ws: Workspace | undefined, lane?: string) => (lane ? ws?.lanes?.[lane]?.code : ws?.code);

/** JavaScript editor. In multi-arm tasks one is shown per arm (`lane` = robot id). */
export default function CodeEditor({ lane }: { lane?: string } = {}) {
  const host = useRef<HTMLDivElement>(null);
  const ed = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const deco = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const taskId = useApp((s) => s.taskId);
  const highlight = useApp((s) => (lane ? s.highlight.lanes?.[lane] ?? NO_HIGHLIGHT : s.highlight));
  const fault = useApp((s) => s.fault);
  const running = useApp((s) => s.runState !== 'idle');

  useEffect(() => {
    configure();
    const code = codeOf(useApp.getState().workspaces[taskId], lane) ?? '';
    const model = monaco.editor.createModel(code, 'javascript', monaco.Uri.parse(`file:///program-${taskId}${lane ? `-${lane}` : ''}.js`));
    const e = monaco.editor.create(host.current!, {
      model, theme: 'tandem', fontFamily: 'JetBrains Mono, ui-monospace, Menlo, monospace', fontSize: 13, lineHeight: 21,
      minimap: { enabled: false }, scrollBeyondLastLine: false, automaticLayout: true, padding: { top: 12, bottom: 12 },
      roundedSelection: true, renderLineHighlight: 'all', smoothScrolling: true, cursorSmoothCaretAnimation: 'on', tabSize: 2,
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 }, fixedOverflowWidgets: true,
    });
    ed.current = e;
    deco.current = e.createDecorationsCollection();
    let pending: ReturnType<typeof setTimeout> | null = null;
    let changes = { added: 0, removed: 0 };
    const sub = model.onDidChangeContent((ev) => {
      for (const c of ev.changes) { changes.added += c.text.length; changes.removed += c.rangeLength; }
      if (lane) updateLane(lane, { code: model.getValue() }); else updateWorkspace({ code: model.getValue() });
      if (pending) clearTimeout(pending);
      pending = setTimeout(() => {
        logEvent('code_edit', { ...changes, ...(lane ? { robot: lane } : {}) });
        changes = { added: 0, removed: 0 };
        logEvent('program_snapshot', { editor: 'code', code: model.getValue(), ...(lane ? { robot: lane } : {}) });
      }, 2000);
    });
    // external updates (accepted agent proposals)
    const unsub = useApp.subscribe((s, prev) => {
      const nc = codeOf(s.workspaces[s.taskId], lane);
      if (nc !== codeOf(prev.workspaces[prev.taskId], lane) && nc !== undefined && nc !== model.getValue()) model.pushEditOperations([], [{ range: model.getFullModelRange(), text: nc }], () => null);
    });
    return () => { sub.dispose(); unsub(); e.dispose(); model.dispose(); if (pending) clearTimeout(pending); };
  }, [taskId, lane]);

  useEffect(() => { ed.current?.updateOptions({ readOnly: running }); }, [running]);

  useEffect(() => {
    const line = highlight.line;
    const fl = lane && fault?.robot && fault.robot !== lane ? undefined : fault?.line;
    const decs: monaco.editor.IModelDeltaDecoration[] = [];
    if (line) decs.push({ range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: 'exec-line', glyphMarginClassName: 'exec-glyph' } });
    if (fl) decs.push({ range: new monaco.Range(fl, 1, fl, 1), options: { isWholeLine: true, className: 'fault-line' } });
    deco.current?.set(decs);
    if (line || fl) ed.current?.revealLineInCenterIfOutsideViewport((line ?? fl)!);
  }, [highlight, fault]);

  return <div className="monaco-host" ref={host} />;
}
