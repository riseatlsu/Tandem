import { useEffect, useState } from 'react';
import { sound, type SoundPrefs } from '../audio/sound';
import { useApp } from '../store';
import { Icon } from './icons';
import { logEvent } from '../study/logger';

export function useSoundPrefs(): [SoundPrefs, (p: Partial<SoundPrefs>) => void] {
  const [p, setP] = useState(sound.prefs);
  useEffect(() => sound.on(setP), []);
  return [p, (np) => { sound.unlock(); sound.set(np); logEvent('panel_toggle', { sound: { ...sound.prefs } }); }];
}

/** Small glass buttons in the top bar: sound effects, and music (demo only). */
export function SoundToggles() {
  const [p, set] = useSoundPrefs();
  const demo = useApp((s) => s.mode === 'demo');
  return (
    <div className="sound-toggles">
      <button className={`round-btn ${p.sfx ? 'on' : ''}`} aria-pressed={p.sfx} aria-label={p.sfx ? 'Mute sound effects' : 'Turn on sound effects'}
        title={p.sfx ? 'Sound effects on' : 'Sound effects off'} onClick={() => set({ sfx: !p.sfx })}>
        {p.sfx ? <Icon.speaker width={16} height={16} /> : <Icon.speakerOff width={16} height={16} />}
      </button>
      {demo && (
        <button className={`round-btn ${p.music ? 'on' : ''}`} aria-pressed={p.music} aria-label={p.music ? 'Turn music off' : 'Turn music on'}
          title={p.music ? 'Music on' : 'Music off'} onClick={() => set({ music: !p.music })}>
          <Icon.music width={16} height={16} />{!p.music && <i className="slash" />}
        </button>
      )}
    </div>
  );
}
