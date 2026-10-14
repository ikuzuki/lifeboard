/** A short two-note chime on completion. WebAudio, so no asset to load or host. */
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as never as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  return ctx;
}

const MUTE_KEY = 'lifeboard.muted';
export const isMuted = () => localStorage.getItem(MUTE_KEY) === '1';
export const setMuted = (m: boolean) => localStorage.setItem(MUTE_KEY, m ? '1' : '0');

export function chime(): void {
  if (isMuted()) return;
  const a = audio();
  if (!a) return;
  if (a.state === 'suspended') void a.resume();

  // A perfect fifth, quiet and short. Anything longer gets annoying by the third task.
  [
    [660, 0],
    [990, 0.09],
  ].forEach(([freq, delay]) => {
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const t = a.currentTime + delay;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.085, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    osc.connect(gain).connect(a.destination);
    osc.start(t);
    osc.stop(t + 0.28);
  });
}

export function buzz(ms = 12): void {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(ms);
}
