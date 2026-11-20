import { useEffect, useRef } from 'react';
import * as Blockly from 'blockly';
import { javascriptGenerator } from 'blockly/javascript';
import * as En from 'blockly/msg/en';
import { defineBlocks, makeTheme, setBlockEnv, toolbox } from './definitions';
import { starterToSteps, stepsToWorkspaceJson, workspaceJsonToSteps } from './steps';
import { useApp, updateWorkspace } from '../store';
import { host } from '../simHost';
import { setGeneratedJs } from '../editor/program';
import { logEvent } from '../study/logger';
import { TASKS } from '../content';

Blockly.setLocale(En as unknown as Record<string, string>);

export function BlocksEditor({ onCode }: { onCode: (js: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const wsRef = useRef<Blockly.WorkspaceSvg | null>(null);
  const taskId = useApp((s) => s.taskId);
  const highlight = useApp((s) => s.highlight);
  const fault = useApp((s) => s.fault);
  const running = useApp((s) => s.runState !== 'idle');

  useEffect(() => {
    defineBlocks();
    setBlockEnv({
      targetNames: () => (host.sim ? Object.keys({ ...host.sim.allTargets(), ...(useApp.getState().workspaces[useApp.getState().taskId]?.targets ?? {}) }) : []),
      inputs: () => host.sim?.scene.io.inputs ?? [],
      outputs: () => host.sim?.scene.io.outputs ?? [],
      teach: () => (useApp.getState().runState === 'idle' ? host.teach() : null),
    });
    const ws = Blockly.inject(ref.current!, {
      toolbox: toolbox(), theme: makeTheme(), renderer: 'zelos', trashcan: true, sounds: false,
      zoom: { controls: true, wheel: true, startScale: 0.82, maxScale: 1.6, minScale: 0.4, scaleSpeed: 1.15 },
      grid: { spacing: 24, length: 2, colour: '#dbe8f5', snap: true }, move: { scrollbars: true, drag: true, wheel: false },
    });
    wsRef.current = ws;
    const saved = useApp.getState().workspaces[taskId]?.blocks;
    const initial = saved ?? stepsToWorkspaceJson(starterToSteps(TASKS[taskId]?.starter?.blocks as { type: string }[] | undefined));
    Blockly.Events.disable();
    try { Blockly.serialization.workspaces.load(initial, ws); } catch { Blockly.serialization.workspaces.load(stepsToWorkspaceJson([]), ws); }
    if (!ws.getBlocksByType('program_start', false).length) {
      const b = ws.newBlock('program_start'); b.initSvg(); b.render(); b.moveBy(30, 30);
    }
    Blockly.Events.enable();
    ws.addChangeListener(Blockly.Events.disableOrphans);

    const regen = () => {
      const js = javascriptGenerator.workspaceToCode(ws);
      setGeneratedJs(js);
      onCode(js);
    };
    regen();
    let snapTimer: ReturnType<typeof setTimeout> | null = null;
    ws.addChangeListener((e: Blockly.Events.Abstract) => {
      if (e.isUiEvent) return;
      regen();
      const json = Blockly.serialization.workspaces.save(ws);
      updateWorkspace({ blocks: json });
      const be = e as Blockly.Events.BlockBase & { blockId?: string; type: string };
      if (['create', 'delete', 'move', 'change'].includes(e.type)) {
        const blk = be.blockId ? ws.getBlockById(be.blockId) : null;
        logEvent('block_event', { kind: e.type, blockId: be.blockId, blockType: blk?.type });
      }
      if (snapTimer) clearTimeout(snapTimer);
      snapTimer = setTimeout(() => logEvent('program_snapshot', { editor: 'blocks', steps: workspaceJsonToSteps(json), blocks: json }), 2000);
    });
    // external updates (accepted agent proposals)
    const unsub = useApp.subscribe((s, prev) => {
      const nb = s.workspaces[s.taskId]?.blocks;
      if (nb && nb !== prev.workspaces[prev.taskId]?.blocks && (nb as { __external?: boolean }).__external) {
        Blockly.Events.disable();
        ws.clear();
        Blockly.serialization.workspaces.load(nb, ws);
        Blockly.Events.enable();
        regen();
        updateWorkspace({ blocks: Blockly.serialization.workspaces.save(ws) });
      }
    });
    const ro = new ResizeObserver(() => Blockly.svgResize(ws));
    ro.observe(ref.current!);
    return () => { unsub(); ro.disconnect(); ws.dispose(); if (snapTimer) clearTimeout(snapTimer); };
  }, [taskId, onCode]);

  useEffect(() => {
    const ws = wsRef.current; if (!ws) return;
    ws.highlightBlock(highlight.blockId ?? fault?.blockId ?? null);
    const id = fault?.blockId;
    ws.getAllBlocks(false).forEach((b) => b.setWarningText(null));
    if (id && fault) ws.getBlockById(id)?.setWarningText(`${fault.code}: ${fault.message}`);
  }, [highlight, fault]);

  useEffect(() => {
    const ws = wsRef.current; if (!ws) return;
    (ws.options as { readOnly: boolean }).readOnly = false;
    ws.getAllBlocks(false).forEach((b) => b.setMovable(!running));
  }, [running]);

  return <div className="blockly-host" ref={ref} />;
}
