/**
 * Wizard-style "easy programming" blocks (original design). Every block compiles to the
 * same robot API that the code editor uses (see robot-api.d.ts).
 */
import * as Blockly from 'blockly';
import { javascriptGenerator, Order } from 'blockly/javascript';

export interface BlockEnv {
  /** Target names for the arm whose lane the block is in (`lane` is undefined in single-arm programs). */
  targetNames(lane?: string): string[];
  inputs(): { name: string; initial: boolean | string }[];
  outputs(): { name: string; initial: boolean | string }[];
  teach(lane?: string): string | null;
  /** Display name of an arm (multi-arm lanes). */
  laneLabel?(lane: string): string;
  laneColor?(lane: string): string | undefined;
}
let env: BlockEnv = { targetNames: () => [], inputs: () => [], outputs: () => [], teach: () => null };
export const setBlockEnv = (e: BlockEnv) => { env = e; };

export const CATEGORY_COLORS = { motion: '#2d8cf0', gripper: '#12b5a5', signals: '#f39c12', flow: '#8b5cf6', data: '#2fb84a', start: '#1a8cff', together: '#c2255c' };

/** The robot id of the lane a block sits in (its root is a "lane_start" hat), or undefined. */
export function laneOf(b: Blockly.Block | null | undefined): string | undefined {
  const root = b?.getRootBlock();
  return root?.type === 'lane_start' ? (root as unknown as { robot?: string }).robot : undefined;
}

/** Invisible field whose height the lane layout sets, so twin sync blocks line up (SPEC §21.5, D12). */
export class FieldSpacer extends Blockly.Field<string> {
  override SERIALIZABLE = false;
  override EDITABLE = false;
  height = 0;
  constructor() { super(''); }
  private line: SVGLineElement | null = null;
  private label: SVGTextElement | null = null;
  /** A faint dashed line (and "waiting" once there is room) shows the padding is time this arm spends waiting. */
  protected override initView() {
    const g = this.fieldGroup_!;
    this.line = Blockly.utils.dom.createSvgElement('line', { x1: 8, x2: 8, y1: 4, y2: 4, stroke: '#fff', 'stroke-opacity': 0.55, 'stroke-width': 2, 'stroke-dasharray': '3 5', 'stroke-linecap': 'round' }, g) as SVGLineElement;
    this.label = Blockly.utils.dom.createSvgElement('text', { x: 18, y: 0, fill: '#fff', 'fill-opacity': 0.75, 'font-size': 11, 'font-weight': 600, 'font-family': 'Inter, sans-serif' }, g) as SVGTextElement;
    this.label.textContent = 'waiting';
  }
  protected override render_() {
    this.size_ = new Blockly.utils.Size(1, this.height);
    this.line?.setAttribute('y2', String(Math.max(4, this.height - 4)));
    if (this.label) { this.label.setAttribute('y', String(this.height / 2 + 4)); this.label.style.display = this.height > 34 ? '' : 'none'; }
  }
  override getText() { return ''; }
}
/** State of a cross-lane sync block. Twins share `syncId`; `leader` is the robot id leading a move together. */
export interface SyncState { syncId: string; role?: 'lead' | 'follow'; leader?: string }
const newSyncId = () => `sync_${Math.random().toString(36).slice(2, 10)}`;
let leadHandler: ((b: Blockly.Block) => void) | null = null;
/** The lanes editor registers how "Lead the move from this arm" swaps the leader of a move together. */
export const setLeadHandler = (fn: ((b: Blockly.Block) => void) | null) => { leadHandler = fn; };
const TEACH = '__TEACH__';

function targetDropdown(): Blockly.FieldDropdown {
  const field = new Blockly.FieldDropdown(function (this: Blockly.FieldDropdown) {
    const names = env.targetNames(laneOf(this.getSourceBlock()));
    const cur = this.getValue?.();
    const opts: [string, string][] = names.map((n) => [n, n]);
    if (cur && cur !== TEACH && !names.includes(cur)) opts.unshift([`${cur} (missing)`, cur]);
    if (!opts.length) opts.push(['(no targets yet)', '']);
    opts.push(['＋ Teach current pose…', TEACH]);
    return opts;
  }, function (this: Blockly.FieldDropdown, v: string) {
    if (v === TEACH) {
      const n = env.teach(laneOf(this.getSourceBlock()));
      return n ?? null;
    }
    return v;
  });
  return field;
}
function ioDropdown(kind: 'inputs' | 'outputs') {
  return new Blockly.FieldDropdown(() => {
    const l = env[kind]();
    return l.length ? l.map((i) => [i.name, i.name] as [string, string]) : [['(none in this cell)', '']];
  });
}

export const BLOCK_TYPES = [
  'program_start', 'robot_home', 'robot_move', 'robot_move_offset', 'gripper_open', 'gripper_close', 'gripper_if_holding',
  'io_wait_until', 'io_set', 'io_if', 'io_value', 'flow_wait', 'flow_log', 'flow_note',
  'controls_repeat_ext', 'controls_whileUntil', 'controls_if', 'controls_for', 'logic_compare', 'logic_boolean', 'logic_operation', 'logic_negate',
  'math_number', 'math_arithmetic', 'text', 'variables_get', 'variables_set', 'math_change',
  'lane_start', 'sync_wait', 'sync_move',
] as const;
export const SYNC_TYPES = ['sync_wait', 'sync_move'];

let defined = false;

// ---------- block icons: small white line drawings (no emoji), matching the interface's icon set
const svg = (body: string, fill = false) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${fill ? '#fff' : 'none'}" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`)}`;
const ICONS = {
  start: svg('<path d="M7 4.8v14.4c0 .8.9 1.3 1.6.9l11.5-7.2c.6-.4.6-1.4 0-1.8L8.6 3.9C7.9 3.5 7 4 7 4.8z"/>', true),
  home: svg('<path d="M3 11l9-7 9 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5h4v5"/>'),
  move: svg('<path d="M4 12h15"/><path d="M13 6l6 6-6 6"/>'),
  offset: svg('<path d="M5 19L18 6"/><path d="M10 6h8v8"/><path d="M4 4v4M4 4h4" opacity=".6"/>'),
  gripOpen: svg('<path d="M6 3v8"/><path d="M18 3v8"/><path d="M6 11h12"/><path d="M12 11v10"/>'),
  gripClose: svg('<path d="M10 3v8"/><path d="M14 3v8"/><path d="M7 11h10"/><path d="M12 11v10"/>'),
  sensor: svg('<circle cx="12" cy="12" r="2.2"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4"/><path d="M16.2 7.8a6 6 0 0 1 0 8.4"/><path d="M5 5a10 10 0 0 0 0 14"/><path d="M19 5a10 10 0 0 1 0 14"/>'),
  output: svg('<path d="M9 3v5"/><path d="M15 3v5"/><path d="M7 8h10v3a5 5 0 0 1-10 0z"/><path d="M12 16v5"/>'),
  wait: svg('<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.8 1.8"/><path d="M9.5 2.5h5"/>'),
  message: svg('<path d="M4 5h16v11H10l-5 4v-4H4z"/>'),
  note: svg('<path d="M4 20l1.2-4.6L16 4.6l3.4 3.4L8.6 18.8z"/><path d="M13.8 6.8l3.4 3.4"/>'),
  sync: svg('<path d="M4 7h16"/><path d="M4 17h16"/><path d="M8 4v6"/><path d="M16 14v6"/><circle cx="8" cy="17" r="1.6"/><circle cx="16" cy="7" r="1.6"/>'),
  together: svg('<path d="M3 8h13"/><path d="M12 4l4 4-4 4"/><path d="M3 18h13"/><path d="M12 14l4 4-4 4"/>'),
  follow: svg('<path d="M4 12h11"/><path d="M11 7l5 5-5 5"/><path d="M20 5v14" opacity=".7"/>'),
};
const icon = (src: string, alt: string) => new Blockly.FieldImage(src, 16, 16, alt);

export function defineBlocks() {
  if (defined) return;
  defined = true;
  const C = CATEGORY_COLORS;

  Blockly.Blocks['program_start'] = {
    init(this: Blockly.Block) {
      this.appendDummyInput().appendField(icon(ICONS.start, '')).appendField('When Run is pressed');
      this.setNextStatement(true);
      this.setColour(C.start);
      this.setDeletable(false);
      this.setTooltip('Your program starts here. Blocks that are not attached below this are ignored.');
      (this as unknown as { hat: string }).hat = 'cap';
    },
  };
  // ---------- multi-arm lanes (SPEC §21.5)
  Blockly.Blocks['lane_start'] = {
    robot: '' as string,
    label: '' as string,
    init(this: Blockly.Block & { robot: string; label: string }) {
      this.appendDummyInput('HEAD').appendField(icon(ICONS.start, '')).appendField(new Blockly.FieldLabel(''), 'LABEL').appendField('· When Run is pressed');
      this.setNextStatement(true);
      this.setColour(C.start);
      this.setDeletable(false);
      this.setMovable(false);
      this.setTooltip('This arm’s program starts here. All arms start together when you press Run.');
      (this as unknown as { hat: string }).hat = 'cap';
    },
    saveExtraState(this: { robot: string; label: string }) { return { robot: this.robot, label: this.label }; },
    loadExtraState(this: Blockly.Block & { robot: string; label: string }, st: { robot: string; label?: string }) {
      this.robot = st.robot;
      this.label = st.label ?? env.laneLabel?.(st.robot) ?? st.robot;
      this.setFieldValue(this.label, 'LABEL');
      const c = env.laneColor?.(st.robot);
      if (c) this.setColour(c);
    },
  };
  const syncBase = {
    syncId: '' as string,
    /** Adds the alignment spacer row (hidden until the layout needs it). */
    addGap(this: Blockly.Block) {
      this.appendDummyInput('GAP').appendField(new FieldSpacer(), 'GAPF').setVisible(false);
    },
  };
  Blockly.Blocks['sync_wait'] = {
    ...syncBase,
    init(this: Blockly.Block & typeof syncBase) {
      this.syncId = newSyncId();
      this.addGap();
      this.appendDummyInput('BODY').appendField(icon(ICONS.sync, '')).appendField('Wait for each other');
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C.together);
      this.setTooltip('Every arm waits here until all arms reach this block. A copy appears in every arm’s program, on the same row.');
    },
    saveExtraState(this: typeof syncBase): SyncState { return { syncId: this.syncId }; },
    loadExtraState(this: typeof syncBase, st: SyncState) { if (st?.syncId) this.syncId = st.syncId; },
  };
  Blockly.Blocks['sync_move'] = {
    ...syncBase,
    role: 'lead' as 'lead' | 'follow',
    leader: '' as string,
    init(this: Blockly.Block & typeof syncBase & { role: string }) {
      this.syncId = newSyncId();
      this.addGap();
      this.appendDummyInput('LEAD')
        .appendField(icon(ICONS.together, '')).appendField('Move together to').appendField(targetDropdown(), 'TARGET')
        .appendField('speed').appendField(new Blockly.FieldNumber(30, 1, 100, 1), 'SPEED').appendField('%');
      this.appendDummyInput('FOLLOW').appendField(icon(ICONS.follow, '')).appendField('Follow').appendField(new Blockly.FieldLabel(''), 'LEADER').appendField('(keep the same distance)');
      this.getInput('FOLLOW')!.setVisible(false);
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C.together);
      this.setTooltip('This arm moves in a straight line to the position; the other arms follow and keep their distance, so a part held by several arms moves with them.');
    },
    updateShape(this: Blockly.Block & { role: string; leader: string }) {
      const follow = this.role === 'follow';
      this.getInput('LEAD')?.setVisible(!follow);
      this.getInput('FOLLOW')?.setVisible(follow);
      if (follow) this.setFieldValue(env.laneLabel?.(this.leader) ?? this.leader, 'LEADER');
      if ((this as unknown as { rendered?: boolean }).rendered) (this as unknown as Blockly.BlockSvg).queueRender();
    },
    customContextMenu(this: Blockly.Block & { role: string }, options: { text: string; enabled: boolean; callback: () => void }[]) {
      if (this.isInFlyout) return;
      options.push({ text: 'Lead the move from this arm', enabled: this.role === 'follow' && !!leadHandler, callback: () => leadHandler?.(this) });
    },
    saveExtraState(this: typeof syncBase & { role: string; leader: string }): SyncState { return { syncId: this.syncId, role: this.role as 'lead' | 'follow', leader: this.leader }; },
    loadExtraState(this: typeof syncBase & { role: string; leader: string; updateShape(): void }, st: SyncState) {
      if (st?.syncId) this.syncId = st.syncId;
      this.role = st?.role ?? 'lead';
      this.leader = st?.leader ?? '';
      this.updateShape();
    },
  };

  Blockly.Blocks['robot_home'] = {
    init(this: Blockly.Block) {
      this.appendDummyInput().appendField(icon(ICONS.home, '')).appendField('Go home').appendField('speed').appendField(new Blockly.FieldNumber(50, 1, 100, 1), 'SPEED').appendField('%');
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C.motion);
      this.setTooltip('Move every joint back to the home position.');
    },
  };
  Blockly.Blocks['robot_move'] = {
    init(this: Blockly.Block) {
      this.appendDummyInput()
        .appendField(icon(ICONS.move, '')).appendField('Move to').appendField(targetDropdown(), 'TARGET')
        .appendField(new Blockly.FieldDropdown([['joint move', 'J'], ['straight line', 'L']]), 'MODE')
        .appendField('speed').appendField(new Blockly.FieldNumber(50, 1, 100, 1), 'SPEED').appendField('%');
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C.motion);
      this.setTooltip('Move the tool to a taught target. A joint move is fastest; a straight line keeps the tool on a line (use it for approach and retreat).');
    },
  };
  Blockly.Blocks['robot_move_offset'] = {
    init(this: Blockly.Block) {
      this.appendDummyInput().appendField(icon(ICONS.offset, '')).appendField('Move to').appendField(targetDropdown(), 'TARGET').appendField('shifted by');
      this.appendValueInput('DX').setCheck('Number').appendField('X');
      this.appendValueInput('DY').setCheck('Number').appendField('Y');
      this.appendValueInput('DZ').setCheck('Number').appendField('Z');
      this.appendDummyInput().appendField('mm').appendField(new Blockly.FieldDropdown([['joint move', 'J'], ['straight line', 'L']]), 'MODE')
        .appendField('speed').appendField(new Blockly.FieldNumber(50, 1, 100, 1), 'SPEED').appendField('%');
      this.setInputsInline(true);
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C.motion);
      this.setTooltip('Move to a target shifted in the base frame — useful for approach heights and grids.');
    },
  };
  Blockly.Blocks['gripper_open'] = {
    init(this: Blockly.Block) {
      this.appendDummyInput().appendField(icon(ICONS.gripOpen, '')).appendField('Open gripper');
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C.gripper);
    },
  };
  Blockly.Blocks['gripper_close'] = {
    init(this: Blockly.Block) {
      this.appendDummyInput().appendField(icon(ICONS.gripClose, '')).appendField('Close gripper');
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C.gripper);
      this.setTooltip('Close the fingers. A part between the fingers is picked up.');
    },
  };
  Blockly.Blocks['gripper_if_holding'] = {
    init(this: Blockly.Block) {
      this.appendDummyInput().appendField(icon(ICONS.gripClose, '')).appendField('If the gripper is holding a part');
      this.appendStatementInput('DO').appendField('then');
      this.appendStatementInput('ELSE').appendField('otherwise');
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C.gripper);
    },
  };
  Blockly.Blocks['io_wait_until'] = {
    init(this: Blockly.Block) {
      this.appendDummyInput().appendField(icon(ICONS.sensor, '')).appendField('Wait until').appendField(ioDropdown('inputs'), 'INPUT').appendField('is').appendField(new Blockly.FieldTextInput('true'), 'VALUE')
        .appendField('timeout').appendField(new Blockly.FieldNumber(0, 0, 3600, 1), 'TIMEOUT').appendField('s');
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C.signals);
      this.setTooltip('Pause until a sensor reports a value. Timeout 0 waits forever.');
    },
  };
  Blockly.Blocks['io_set'] = {
    init(this: Blockly.Block) {
      this.appendDummyInput().appendField(icon(ICONS.output, '')).appendField('Set').appendField(ioDropdown('outputs'), 'OUTPUT').appendField('to').appendField(new Blockly.FieldTextInput('true'), 'VALUE');
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C.signals);
    },
  };
  Blockly.Blocks['io_if'] = {
    init(this: Blockly.Block) {
      this.appendDummyInput().appendField(icon(ICONS.sensor, '')).appendField('If').appendField(ioDropdown('inputs'), 'INPUT').appendField('is').appendField(new Blockly.FieldTextInput('true'), 'VALUE');
      this.appendStatementInput('DO').appendField('then');
      this.appendStatementInput('ELSE').appendField('otherwise');
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C.signals);
    },
  };
  Blockly.Blocks['io_value'] = {
    init(this: Blockly.Block) {
      this.appendDummyInput().appendField('sensor').appendField(ioDropdown('inputs'), 'INPUT');
      this.setOutput(true, null); this.setColour(C.signals);
    },
  };
  Blockly.Blocks['flow_wait'] = {
    init(this: Blockly.Block) {
      this.appendDummyInput().appendField(icon(ICONS.wait, '')).appendField('Wait').appendField(new Blockly.FieldNumber(1, 0, 3600, 0.1), 'SEC').appendField('seconds');
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C.flow);
    },
  };
  Blockly.Blocks['flow_log'] = {
    init(this: Blockly.Block) {
      this.appendValueInput('MSG').appendField(icon(ICONS.message, '')).appendField('Show message');
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C.flow);
    },
  };
  Blockly.Blocks['flow_note'] = {
    init(this: Blockly.Block) {
      this.appendDummyInput().appendField(icon(ICONS.note, '')).appendField('Note').appendField(new Blockly.FieldTextInput('note'), 'TEXT');
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour('#94a3b8');
      this.setTooltip('A note for humans. Does nothing when the program runs.');
    },
  };

  // ---------- generator
  const g = javascriptGenerator;
  g.STATEMENT_PREFIX = 'await __hl(%1);\n';
  g.addReservedWords('robot,gripper,io,targets,offset,log,__hl,sync');
  const lit = (v: string) => {
    const t = v.trim();
    if (t === 'true' || t === 'false') return t;
    if (t !== '' && !isNaN(Number(t))) return String(Number(t));
    return JSON.stringify(t);
  };
  const num = (b: Blockly.Block, name: string) => g.valueToCode(b, name, Order.ATOMIC) || '0';
  g.forBlock['program_start'] = () => '';
  g.forBlock['lane_start'] = () => '';
  g.forBlock['sync_wait'] = () => 'await sync();\n';
  g.forBlock['sync_move'] = (b) => ((b as unknown as { role: string }).role === 'follow'
    ? 'await robot.follow();\n'
    : `await robot.moveTogether(${JSON.stringify(b.getFieldValue('TARGET'))}, { speed: ${Number(b.getFieldValue('SPEED'))} });\n`);
  g.forBlock['robot_home'] = (b) => `await robot.home({ speed: ${Number(b.getFieldValue('SPEED'))} });\n`;
  g.forBlock['robot_move'] = (b) => `await robot.move${b.getFieldValue('MODE')}(${JSON.stringify(b.getFieldValue('TARGET'))}, { speed: ${Number(b.getFieldValue('SPEED'))} });\n`;
  g.forBlock['robot_move_offset'] = (b) =>
    `await robot.move${b.getFieldValue('MODE')}(offset(${JSON.stringify(b.getFieldValue('TARGET'))}, ${num(b, 'DX')}, ${num(b, 'DY')}, ${num(b, 'DZ')}), { speed: ${Number(b.getFieldValue('SPEED'))} });\n`;
  g.forBlock['gripper_open'] = () => 'await gripper.open();\n';
  g.forBlock['gripper_close'] = () => 'await gripper.close();\n';
  g.forBlock['gripper_if_holding'] = (b) => `if (await gripper.holding()) {\n${g.statementToCode(b, 'DO')}} else {\n${g.statementToCode(b, 'ELSE')}}\n`;
  g.forBlock['io_wait_until'] = (b) => {
    const t = Number(b.getFieldValue('TIMEOUT'));
    return `await io.waitFor(${JSON.stringify(b.getFieldValue('INPUT'))}, ${lit(b.getFieldValue('VALUE'))}${t > 0 ? `, ${t * 1000}` : ''});\n`;
  };
  g.forBlock['io_set'] = (b) => `await io.set(${JSON.stringify(b.getFieldValue('OUTPUT'))}, ${lit(b.getFieldValue('VALUE'))});\n`;
  g.forBlock['io_if'] = (b) => `if ((await io.get(${JSON.stringify(b.getFieldValue('INPUT'))})) === ${lit(b.getFieldValue('VALUE'))}) {\n${g.statementToCode(b, 'DO')}} else {\n${g.statementToCode(b, 'ELSE')}}\n`;
  g.forBlock['io_value'] = (b) => [`(await io.get(${JSON.stringify(b.getFieldValue('INPUT'))}))`, Order.ATOMIC];
  g.forBlock['flow_wait'] = (b) => `await robot.wait(${Math.round(Number(b.getFieldValue('SEC')) * 1000)});\n`;
  g.forBlock['flow_log'] = (b) => `log(${g.valueToCode(b, 'MSG', Order.NONE) || "''"});\n`;
  g.forBlock['flow_note'] = (b) => `// ${String(b.getFieldValue('TEXT')).replace(/\n/g, ' ')}\n`;
}

export function makeTheme() {
  return Blockly.Theme.defineTheme('tandem', {
    name: 'tandem',
    base: Blockly.Themes.Classic,
    componentStyles: {
      workspaceBackgroundColour: '#f6fbff',
      toolboxBackgroundColour: '#f3f9ff',
      toolboxForegroundColour: '#3a5372',
      flyoutBackgroundColour: '#eef6ff',
      flyoutForegroundColour: '#3a5372',
      flyoutOpacity: 0.96,
      scrollbarColour: '#c6d8ec',
      scrollbarOpacity: 0.8,
      insertionMarkerColour: '#1a8cff',
      insertionMarkerOpacity: 0.35,
      cursorColour: '#1a8cff',
    },
    blockStyles: {
      loop_blocks: { colourPrimary: '#8b5cf6', colourSecondary: '#c4b5fd', colourTertiary: '#6d28d9' },
      logic_blocks: { colourPrimary: '#8b5cf6', colourSecondary: '#c4b5fd', colourTertiary: '#6d28d9' },
      math_blocks: { colourPrimary: '#2fb84a', colourSecondary: '#86efac', colourTertiary: '#15803d' },
      text_blocks: { colourPrimary: '#2fb84a', colourSecondary: '#86efac', colourTertiary: '#15803d' },
      variable_blocks: { colourPrimary: '#e0569b', colourSecondary: '#f9a8d4', colourTertiary: '#be185d' },
      procedure_blocks: { colourPrimary: '#64748b', colourSecondary: '#cbd5e1', colourTertiary: '#334155' },
    },
    categoryStyles: {},
    fontStyle: { family: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif', weight: '600', size: 12 },
    startHats: true,
  });
}

/** The block toolbox; multi-arm tasks add the "Together" category. */
export function toolbox(multi = false) {
  const C = CATEGORY_COLORS;
  const shadowNum = (n: number) => ({ shadow: { type: 'math_number', fields: { NUM: n } } });
  return {
    kind: 'categoryToolbox',
    contents: [
      { kind: 'category', name: 'Motion', colour: C.motion, contents: [
        { kind: 'block', type: 'robot_home' },
        { kind: 'block', type: 'robot_move' },
        { kind: 'block', type: 'robot_move', fields: { MODE: 'L' } },
        { kind: 'block', type: 'robot_move_offset', inputs: { DX: shadowNum(0), DY: shadowNum(0), DZ: shadowNum(100) } },
      ] },
      { kind: 'category', name: 'Gripper', colour: C.gripper, contents: [
        { kind: 'block', type: 'gripper_open' }, { kind: 'block', type: 'gripper_close' }, { kind: 'block', type: 'gripper_if_holding' },
      ] },
      { kind: 'category', name: 'Signals', colour: C.signals, contents: [
        { kind: 'block', type: 'io_wait_until' }, { kind: 'block', type: 'io_if' }, { kind: 'block', type: 'io_set' }, { kind: 'block', type: 'io_value' },
      ] },
      { kind: 'category', name: 'Flow', colour: C.flow, contents: [
        { kind: 'block', type: 'controls_repeat_ext', inputs: { TIMES: shadowNum(3) } },
        { kind: 'block', type: 'controls_for', inputs: { FROM: shadowNum(0), TO: shadowNum(2), BY: shadowNum(1) } },
        { kind: 'block', type: 'controls_whileUntil' },
        { kind: 'block', type: 'controls_if' },
        { kind: 'block', type: 'logic_compare' },
        { kind: 'block', type: 'flow_wait' },
        { kind: 'block', type: 'flow_log', inputs: { MSG: { shadow: { type: 'text', fields: { TEXT: 'hello' } } } } },
        { kind: 'block', type: 'flow_note' },
      ] },
      { kind: 'category', name: 'Data', colour: C.data, contents: [
        { kind: 'block', type: 'math_number' },
        { kind: 'block', type: 'math_arithmetic', inputs: { A: shadowNum(1), B: shadowNum(70) } },
        { kind: 'block', type: 'text' },
        { kind: 'block', type: 'logic_boolean' },
      ] },
      { kind: 'category', name: 'Variables', colour: '#e0569b', custom: 'VARIABLE' },
      ...(multi ? [{ kind: 'category', name: 'Together', colour: C.together, contents: [
        { kind: 'block', type: 'sync_wait' },
        { kind: 'block', type: 'sync_move' },
      ] }] : []),
    ],
  };
}
