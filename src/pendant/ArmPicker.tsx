import { useApp } from '../store';
import { host } from '../simHost';

/** Multi-arm cells: choose the arm that Jog, Positions, hand guide and Teach act on (SPEC §21.6). Renders nothing for one arm. */
export function ArmPicker() {
  const arm = useApp((s) => s.arm);
  const running = useApp((s) => s.runState !== 'idle');
  const sim = host.sim;
  if (!sim?.multi) return null;
  return (
    <div className="seg arm-picker" role="tablist" aria-label="Arm">
      {sim.robotIds.map((id) => (
        <button key={id} role="tab" aria-selected={arm === id} className={arm === id ? 'on' : ''} disabled={running && arm !== id} onClick={() => host.selectArm(id)}>
          <span className="arm-dot" style={{ background: sim.color(id) ?? '#1a8cff' }} />{sim.label(id)}
        </button>
      ))}
    </div>
  );
}
