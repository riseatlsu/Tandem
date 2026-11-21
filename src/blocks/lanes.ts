/**
 * Duplo-style lanes in one Blockly workspace (SPEC §21.5): one "lane_start" hat per arm, side by side.
 * Keeps cross-lane sync blocks ("Wait for each other", "Move together") twinned in every lane, refuses them
 * inside loops/ifs, re-spaces lanes to fit their blocks and pads twins so they sit on the same row.
 */
import * as Blockly from 'blockly';
import { javascriptGenerator } from 'blockly/javascript';
import { FieldSpacer, SYNC_TYPES, laneOf, setLeadHandler } from './definitions';

type Hat = Blockly.BlockSvg & { robot: string; label: string };
type SyncBlock = Blockly.BlockSvg & { syncId: string; role?: 'lead' | 'follow'; leader?: string; updateShape?(): void };

const LANE_GAP = 56;
const MIN_LANE_W = 300;
const TOP = 30;

export const isSync = (b: Blockly.Block | null | undefined): b is SyncBlock => !!b && SYNC_TYPES.includes(b.type);

export function hats(ws: Blockly.Workspace): Hat[] {
  return (ws.getTopBlocks(false).filter((b) => b.type === 'lane_start') as Hat[]);
}
export function hatsInOrder(ws: Blockly.Workspace, order: string[]): Hat[] {
  const hs = hats(ws);
  return order.map((r) => hs.find((h) => h.robot === r)).filter((h): h is Hat => !!h);
}
/** Blocks on a lane's main chain (not inside loops/ifs). */
export function chain(hat: Blockly.Block): Blockly.BlockSvg[] {
  const out: Blockly.BlockSvg[] = [];
  for (let b = hat.getNextBlock(); b; b = b.getNextBlock()) out.push(b as Blockly.BlockSvg);
  return out;
}
const syncsOf = (hat: Blockly.Block) => chain(hat).filter(isSync);
/** True when a block sits inside a C-block's statement input (not on a lane's main chain). */
function nested(b: Blockly.Block): boolean {
  for (let cur: Blockly.Block | null = b; cur; cur = cur.getParent()) {
    const parent = cur.getParent();
    if (parent && parent.getNextBlock() !== cur) return true;
  }
  return false;
}

/** Per-lane generated JavaScript (robot id → program). */
export function lanesCode(ws: Blockly.Workspace, order: string[]): Record<string, string> {
  const g = javascriptGenerator;
  const out: Record<string, string> = {};
  for (const h of hatsInOrder(ws, order)) {
    g.init(ws);
    const code = g.blockToCode(h);
    out[h.robot] = g.finish(typeof code === 'string' ? code : code[0]);
  }
  for (const r of order) out[r] ??= '';
  return out;
}

export interface LaneHooks {
  /** A sync block was refused (dropped inside a loop/if). */
  onRefused(msg: string): void;
  /** A twin set was created or removed (study logging). */
  onSync?(kind: 'add' | 'remove', b: { syncId: string; type: string; leader?: string }): void;
  /** Targets of an arm, to keep a leader's target valid when the leader changes. */
  targetNames(robot: string): string[];
  label(robot: string): string;
  /** Something changed that Blockly doesn't record as an event (e.g. who leads a move together): save the workspace. */
  onChanged?(): void;
}

/**
 * Wires twin maintenance and layout into a lanes workspace. Returns a function that re-runs the layout
 * (call after loading or resizing).
 */
export function attachLanes(ws: Blockly.WorkspaceSvg, order: string[], hooks: LaneHooks): () => void {
  let applying = false;
  /**
   * Twin maintenance emits no Blockly events: events are delivered asynchronously, so our own changes would come
   * back looking like user edits (a twin's delete event would delete the block the user just placed). The editor's
   * save listener runs after this one for the same user event, so twins are still saved; undoing the user's edit
   * removes or restores twins through this listener again.
   */
  const withGroup = (_group: string | undefined, fn: () => void) => {
    const wasEnabled = Blockly.Events.isEnabled();
    applying = true;
    Blockly.Events.disable();
    try { fn(); } finally { if (wasEnabled) Blockly.Events.enable(); applying = false; }
  };

  const allSync = () => ws.getAllBlocks(false).filter(isSync) as SyncBlock[];
  const twinsOf = (b: SyncBlock) => allSync().filter((x) => x !== b && x.syncId === b.syncId);

  /** Where a twin of `b` (in lane `from`, k-th sync there) goes in lane `hat`: after the returned block. */
  function insertAfter(hat: Hat, k: number, y: number): Blockly.BlockSvg {
    const c = chain(hat);
    const syncs = c.filter(isSync);
    const lo = k === 0 ? -1 : c.indexOf(syncs[k - 1] ?? c[c.length - 1]);
    const hiBlock = syncs[k];
    const hi = hiBlock ? c.indexOf(hiBlock) : c.length;
    let at = lo;
    for (let i = lo + 1; i < hi; i++) if (c[i].getRelativeToSurfaceXY().y <= y) at = i;
    return at < 0 ? hat : c[at];
  }

  function makeTwin(b: SyncBlock, leaderLane: string, lane: string): SyncBlock {
    const t = ws.newBlock(b.type) as SyncBlock;
    t.syncId = b.syncId;
    if (b.type === 'sync_move') { t.role = lane === leaderLane ? 'lead' : 'follow'; t.leader = leaderLane; t.updateShape?.(); }
    t.initSvg();
    t.render();
    return t;
  }
  /** Keep a leader's target valid for its own arm (each arm has its own position names). */
  function fixTarget(b: SyncBlock, lane: string, preferred?: string) {
    const names = hooks.targetNames(lane);
    const cur = preferred ?? b.getFieldValue('TARGET');
    b.setFieldValue(cur && names.includes(cur) ? cur : names[0] ?? '', 'TARGET');
  }

  /**
   * Re-create `b`'s twins in every other lane at the matching position (same order among sync blocks, nearest row).
   * For a move together, the current leader keeps leading unless `takeLead` (a copy dragged into another lane leads).
   */
  function retwin(b: SyncBlock, takeLead = false) {
    const lane = laneOf(b)!;
    const old = twinsOf(b);
    let leaderLane = lane, target: string | undefined, speed: number | undefined;
    if (b.type === 'sync_move' && !takeLead && b.role === 'follow') {
      const lead = old.find((x) => x.role !== 'follow' && laneOf(x) && laneOf(x) !== lane);
      if (lead) { leaderLane = laneOf(lead)!; target = lead.getFieldValue('TARGET'); speed = Number(lead.getFieldValue('SPEED')); }
    }
    for (const t of old) t.dispose(true);
    if (b.type === 'sync_move') {
      b.role = leaderLane === lane ? 'lead' : 'follow'; b.leader = leaderLane; b.updateShape?.();
      if (b.role === 'lead') fixTarget(b, lane);
    }
    const myHat = hats(ws).find((h) => h.robot === lane)!;
    const k = syncsOf(myHat).indexOf(b);
    const y = b.getRelativeToSurfaceXY().y;
    for (const h of hatsInOrder(ws, order)) {
      if (h.robot === lane) continue;
      const after = insertAfter(h, k, y);
      const t = makeTwin(b, leaderLane, h.robot);
      after.nextConnection!.connect(t.previousConnection!);
      if (t.role === 'lead') { fixTarget(t, h.robot, target); if (speed) t.setFieldValue(speed, 'SPEED'); }
    }
  }
  /** Every copy is on its lane's main chain, at the same position among that lane's sync blocks. */
  function inOrder(b: SyncBlock, twins: SyncBlock[]): boolean {
    const idx = (x: SyncBlock) => { const h = hats(ws).find((hh) => hh.robot === laneOf(x)); return h ? syncsOf(h).indexOf(x) : -1; };
    const k = idx(b);
    return k >= 0 && twins.every((t) => idx(t) === k);
  }
  /** Context menu "Lead the move from this arm": swap which arm leads a move together. */
  setLeadHandler((blk) => {
    const b = blk as SyncBlock;
    const lane = laneOf(b);
    if (!lane || b.type !== 'sync_move' || b.role !== 'follow') return;
    withGroup(undefined, () => {
      const group = [b, ...twinsOf(b)];
      const old = group.find((x) => x.role !== 'follow');
      const target = old?.getFieldValue('TARGET');
      for (const x of group) { x.role = x === b ? 'lead' : 'follow'; x.leader = lane; x.updateShape?.(); }
      fixTarget(b, lane, target);
    });
    hooks.onChanged?.();
    schedule();
  });

  /** Repair after paste/undo: duplicates in one lane get a fresh id; missing twins are added; one leader per move. */
  function repair() {
    const hs = hatsInOrder(ws, order);
    const seen = new Map<string, SyncBlock[]>();
    for (const h of hs) {
      const local = new Set<string>();
      for (const b of syncsOf(h)) {
        if (local.has(b.syncId)) b.syncId = `sync_${Math.random().toString(36).slice(2, 10)}`;
        local.add(b.syncId);
        seen.set(b.syncId, [...(seen.get(b.syncId) ?? []), b]);
      }
    }
    for (const [, group] of seen) {
      if (group.length < hs.length) { retwin(group.find((g) => g.role !== 'follow') ?? group[0]); continue; }
      if (group[0].type === 'sync_move') {
        const leads = group.filter((g) => g.role !== 'follow');
        const lead = leads[0] ?? group[0];
        for (const g of group) {
          const role = g === lead ? 'lead' : 'follow';
          const leader = laneOf(lead)!;
          if (g.role !== role || g.leader !== leader) { g.role = role; g.leader = leader; g.updateShape?.(); }
        }
      }
    }
  }

  ws.addChangeListener((e: Blockly.Events.Abstract) => {
    if (applying || e.isUiEvent) return;
    if (e.type === Blockly.Events.BLOCK_DELETE) {
      const d = e as Blockly.Events.BlockDelete;
      const st = (d.oldJson as { extraState?: { syncId?: string } } | undefined)?.extraState;
      if (st?.syncId && SYNC_TYPES.includes(d.oldJson?.type ?? '')) {
        withGroup(e.group, () => { for (const b of allSync()) if (b.syncId === st.syncId) b.dispose(true); });
        hooks.onSync?.('remove', { syncId: st.syncId, type: d.oldJson!.type });
      }
    } else if (e.type === Blockly.Events.BLOCK_MOVE) {
      const m = e as Blockly.Events.BlockMove;
      const b = m.blockId ? ws.getBlockById(m.blockId) : null;
      // a dragged stack may carry sync blocks: handle every sync block in it
      const moved = b ? [b, ...b.getDescendants(false)].filter(isSync) as SyncBlock[] : [];
      if (moved.length) withGroup(e.group, () => {
        for (const s of moved) {
          const lane = laneOf(s);
          if (lane && nested(s)) {
            s.unplug(true);
            s.moveBy(30, 30);
            for (const t of twinsOf(s)) t.dispose(true);
            hooks.onRefused('“Wait for each other” and “Move together” go directly in an arm’s program, not inside a loop or if — every arm must reach them the same number of times.');
          } else if (lane) {
            const twins = twinsOf(s);
            const crossLane = twins.some((t) => laneOf(t) === lane); // dragged into a lane that already had a copy
            const complete = twins.length === order.length - 1;
            // moved within its own lane and still in the same order: only this copy moves; rows re-align (D12)
            if (!crossLane && complete && inOrder(s, twins)) continue;
            retwin(s, crossLane || twins.length === 0);
            if (twins.length === 0) hooks.onSync?.('add', { syncId: s.syncId, type: s.type, leader: s.leader });
          } else if (twinsOf(s).length) {
            for (const t of twinsOf(s)) t.dispose(true);
            hooks.onSync?.('remove', { syncId: s.syncId, type: s.type });
          }
        }
      });
    }
    if (e.type === Blockly.Events.BLOCK_CREATE || e.type === Blockly.Events.BLOCK_MOVE || e.type === Blockly.Events.BLOCK_DELETE) {
      withGroup(e.group, repair);
    }
    schedule();
  });

  // Layout runs async (it waits for Blockly to render between passes). It must not swallow the user's own
  // edits in the meantime, so events are suppressed only around its own synchronous changes.
  let pending = 0, running = false, again = false;
  const schedule = () => { if (!pending) pending = requestAnimationFrame(() => { pending = 0; void runLayout(); }); };
  async function runLayout() {
    if (running) { again = true; return; }
    running = true;
    try { do { again = false; await layout(); } while (again); } finally { running = false; }
  }
  const quiet = <T>(fn: () => T): T => {
    const wasEnabled = Blockly.Events.isEnabled();
    applying = true;
    Blockly.Events.disable();
    try { return fn(); } finally { if (wasEnabled) Blockly.Events.enable(); applying = false; }
  };
  const settle = () => Blockly.renderManagement.finishQueuedRenders();

  async function layout() {
    if (!ws.rendered || !ws.getParentSvg()) return;
    await settle();
    if (!ws.rendered) return;
    const hs = hatsInOrder(ws, order);
    // 1. space lanes to fit their widest stack
    quiet(() => {
      let x = TOP;
      for (const h of hs) {
        const p = h.getRelativeToSurfaceXY();
        if (Math.abs(p.x - x) > 0.5 || Math.abs(p.y - TOP) > 0.5) h.moveTo(new Blockly.utils.Coordinate(x, TOP));
        x += Math.max(MIN_LANE_W, h.getHeightWidth().width) + LANE_GAP;
      }
    });
    // 2. line up the k-th sync block of every lane by padding the higher ones
    const lanes = hs.map(syncsOf);
    const n = lanes.length ? Math.min(...lanes.map((l) => l.length)) : 0;
    const gap = (b: SyncBlock) => b.getField('GAPF') as FieldSpacer;
    const setGap = (b: SyncBlock, h: number, show = h > 0.5) => quiet(() => {
      const f = gap(b), input = b.getInput('GAP');
      if (!f || !input || (f.height === h && input.isVisible() === show)) return false;
      f.height = Math.max(0, h);
      input.setVisible(show);
      f.forceRerender();
      return true;
    });
    for (const l of lanes) for (const b of l.slice(n)) setGap(b, 0);
    const bottom = (b: SyncBlock) => b.getRelativeToSurfaceXY().y + b.height;
    for (let k = 0; k < n; k++) {
      const row = lanes.map((l) => l[k]);
      if (row.some((b) => b.isDisposed())) return; // edited meanwhile; the change schedules a fresh layout
      // natural positions with no padding
      if (row.map((b) => setGap(b, 0)).some(Boolean)) await settle();
      const natural = row.map(bottom);
      if (Math.max(...natural) - Math.min(...natural) <= 0.5) continue;
      // a visible spacer row has a minimum height, so pad every twin and size each spacer to the tallest
      row.forEach((b) => setGap(b, 0, true));
      await settle();
      const base = row.map((b, i) => bottom(b) - natural[i]); // extra height of an empty spacer row
      const target = Math.max(...row.map((_, i) => natural[i] + base[i]));
      for (let iter = 0; iter < 10; iter++) {
        let changed = false;
        row.forEach((b) => {
          const d = target - bottom(b);
          if (Math.abs(d) > 0.5) changed = setGap(b, Math.max(0, gap(b).height + d), true) || changed;
        });
        if (!changed) break;
        await settle();
      }
    }
  }
  return schedule;
}
