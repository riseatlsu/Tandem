import { useEffect, useRef } from 'react';
import * as Blockly from 'blockly';
import { javascriptGenerator } from 'blockly/javascript';
import * as En from 'blockly/msg/en';
import { defineBlocks, makeTheme, setBlockEnv, toolbox } from './definitions';
import { lanesToWorkspaceJson, starterToSteps, stepsToWorkspaceJson, workspaceJsonToLanes, workspaceJsonToSteps, type Step } from './steps';
import { attachLanes, hats, lanesCode } from './lanes';
import { laneTargets, toast, useApp, updateWorkspace } from '../store';
import { host } from '../simHost';
import { setGeneratedJs } from '../editor/program';
import { logEvent } from '../study/logger';
import { TASKS } from '../content';

Blockly.setLocale(En as unknown as Record<string, string>);

/** Target names an arm can use: the cell's positions plus the ones taught on that arm. */
function targetNames(lane?: string): string[] {
  if (!host.sim) return [];
  const st = useApp.getState();
  const robot = lane ?? host.sim.primary;
  return Object.keys({ ...host.sim.allTargets(robot), ...laneTargets(st.workspaces[st.taskId], robot) });
}

export function BlocksEditor({ onCode }: { onCode: (js: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const wsRef = useRef<Blockly.WorkspaceSvg | null>(null);
  const taskId = useApp((s) => s.taskId);
  const highlight = useApp((s) => s.highlight);
  const laneStates = useApp((s) => s.laneStates);
  const fault = useApp((s) => s.fault);
  const running = useApp((s) => s.runState !== 'idle');

  useEffect(() => {
    defineBlocks();
    const sim = host.sim;
    const multi = !!sim?.multi;
    const order = sim?.robotIds ?? ['A'];
    setBlockEnv({
      targetNames,
      inputs: () => host.sim?.scene.io.inputs ?? [],
      outputs: () => host.sim?.scene.io.outputs ?? [],
      teach: (lane) => (useApp.getState().runState === 'idle' ? host.teach(undefined, lane) : null),
      laneLabel: (r) => host.sim?.label(r) ?? r,
      laneColor: (r) => host.sim?.color(r),
    });
    const ws = Blockly.inject(ref.current!, {
      toolbox: toolbox(multi), theme: makeTheme(), renderer: 'zelos', trashcan: true, sounds: false,
      zoom: { controls: true, wheel: true, startScale: multi ? 0.72 : 0.82, maxScale: 1.6, minScale: 0.3, scaleSpeed: 1.15 },
      grid: { spacing: 24, length: 2, colour: '#dbe8f5', snap: !multi }, move: { scrollbars: true, drag: true, wheel: false },
    });
    wsRef.current = ws;
    if (import.meta.env.DEV || import.meta.env.VITE_E2E === 'true') (window as unknown as Record<string, unknown>).__tandemBlockly = { ws, Blockly };
    const labels = Object.fromEntries(order.map((r) => [r, sim?.label(r) ?? r]));
    const saved = useApp.getState().workspaces[taskId]?.blocks;
    const fresh = () => (multi
      ? lanesToWorkspaceJson(Object.fromEntries(order.map((r) => [r, []])), labels, order)
      : stepsToWorkspaceJson((TASKS[taskId]?.starter?.steps as Step[] | undefined) ?? starterToSteps(TASKS[taskId]?.starter?.blocks as { type: string }[] | undefined)));
    Blockly.Events.disable();
    try { Blockly.serialization.workspaces.load(saved ?? fresh(), ws); } catch { Blockly.serialization.workspaces.load(fresh(), ws); }
    if (multi) {
      // every arm needs its hat, even if the saved program predates an arm
      const have = new Set(hats(ws).map((h) => h.robot));
      if (order.some((r) => !have.has(r))) {
        const lanes = workspaceJsonToLanes(Blockly.serialization.workspaces.save(ws));
        ws.clear();
        Blockly.serialization.workspaces.load(lanesToWorkspaceJson(Object.fromEntries(order.map((r) => [r, lanes[r] ?? []])), labels, order), ws);
      }
    } else if (!ws.getBlocksByType('program_start', false).length) {
      const b = ws.newBlock('program_start'); b.initSvg(); b.render(); b.moveBy(30, 30);
    }
    Blockly.Events.enable();
    ws.addChangeListener(Blockly.Events.disableOrphans);
    const relayout = multi ? attachLanes(ws, order, {
      onRefused: (m) => toast(m, 'bad'),
      onSync: (kind, b) => logEvent(kind === 'add' ? 'sync_block_add' : 'sync_block_remove', { syncId: b.syncId, kind: b.type === 'sync_wait' ? 'wait' : 'move', leader: b.leader }),
      targetNames: (r) => targetNames(r),
      label: (r) => host.sim?.label(r) ?? r,
      onChanged: () => { regen(); updateWorkspace({ blocks: Blockly.serialization.workspaces.save(ws) }); },
    }) : null;
    relayout?.();

    const regen = () => {
      if (multi) {
        const code = lanesCode(ws, order);
        setGeneratedJs(code);
        onCode(Object.entries(code).map(([r, c]) => `// ---- ${labels[r]}\n${c}`).join('\n'));
      } else {
        const js = javascriptGenerator.workspaceToCode(ws);
        setGeneratedJs(js);
        onCode(js);
      }
    };
    regen();
    // a starter program (or a repaired workspace) must be in the store right away, not only after the first edit:
    // the AI partner, checkpoints and logs read the program from there
    if (!saved || multi) updateWorkspace({ blocks: Blockly.serialization.workspaces.save(ws) });
    let snapTimer: ReturnType<typeof setTimeout> | null = null;
    ws.addChangeListener((e: Blockly.Events.Abstract) => {
      if (e.isUiEvent) return;
      regen();
      const json = Blockly.serialization.workspaces.save(ws);
      updateWorkspace({ blocks: json });
      const be = e as Blockly.Events.BlockBase & { blockId?: string; type: string };
      if (['create', 'delete', 'move', 'change'].includes(e.type)) {
        const blk = be.blockId ? ws.getBlockById(be.blockId) : null;
        const lane = multi && blk ? (blk.getRootBlock() as unknown as { robot?: string }).robot : undefined;
        logEvent('block_event', { kind: e.type, blockId: be.blockId, blockType: blk?.type, ...(lane ? { robot: lane } : {}) });
      }
      if (snapTimer) clearTimeout(snapTimer);
      snapTimer = setTimeout(() => logEvent('program_snapshot', multi
        ? { editor: 'blocks', lanes: workspaceJsonToLanes(json), blocks: json }
        : { editor: 'blocks', steps: workspaceJsonToSteps(json), blocks: json }), 2000);
    });
    // external updates (accepted agent proposals)
    const unsub = useApp.subscribe((s, prev) => {
      const nb = s.workspaces[s.taskId]?.blocks;
      if (nb && nb !== prev.workspaces[prev.taskId]?.blocks && (nb as { __external?: boolean }).__external) {
        Blockly.Events.disable();
        ws.clear();
        Blockly.serialization.workspaces.load(nb, ws);
        Blockly.Events.enable();
        relayout?.();
        regen();
        updateWorkspace({ blocks: Blockly.serialization.workspaces.save(ws) });
      }
    });
    const ro = new ResizeObserver(() => { Blockly.svgResize(ws); relayout?.(); });
    ro.observe(ref.current!);
    return () => { unsub(); ro.disconnect(); ws.dispose(); if (snapTimer) clearTimeout(snapTimer); };
  }, [taskId, onCode]);

  useEffect(() => {
    const ws = wsRef.current; if (!ws) return;
    const ids = highlight.lanes ? Object.values(highlight.lanes).map((h) => h.blockId).filter((x): x is string => !!x) : [highlight.blockId].filter((x): x is string => !!x);
    if (fault?.blockId && !ids.includes(fault.blockId)) ids.push(fault.blockId);
    ws.highlightBlock(null);
    for (const id of ids) ws.highlightBlock(id, true);
    ws.getAllBlocks(false).forEach((b) => {
      b.setWarningText(null);
      (b as Blockly.BlockSvg).getSvgRoot()?.classList.remove('blocklyWaiting');
    });
    if (fault?.blockId) ws.getBlockById(fault.blockId)?.setWarningText(`${fault.code}: ${fault.message}`);
    // arms parked at a sync glow until the others arrive
    for (const [lane, st] of Object.entries(laneStates)) {
      if (st !== 'parked') continue;
      const id = highlight.lanes?.[lane]?.blockId;
      const b = id ? ws.getBlockById(id) as Blockly.BlockSvg | null : null;
      b?.getSvgRoot()?.classList.add('blocklyWaiting');
    }
  }, [highlight, fault, laneStates]);

  useEffect(() => {
    const ws = wsRef.current; if (!ws) return;
    (ws.options as { readOnly: boolean }).readOnly = false;
    ws.getAllBlocks(false).forEach((b) => b.setMovable(!running && b.type !== 'lane_start'));
  }, [running]);

  return <div className="blockly-host" ref={ref} />;
}
