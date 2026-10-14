/**
 * Voice capture via the browser's own SpeechRecognition. No API cost and no server.
 * Chrome on Android is the target; Safari and Firefox largely lack it.
 *
 * Dictation is one way to fill the brain dump box, never a separate mode, so callers
 * degrade in two directions: `unsupported` hides the control, `insecure-context`
 * shows it disabled with a reason. Recognition needs a secure context, so a plain
 * LAN IP has the constructor but fails on start; saying so beats a dead button.
 */
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: SpeechResults) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

interface SpeechResults {
  resultIndex?: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }>;
}

export type SpeechState = 'ok' | 'unsupported' | 'insecure-context';

const Ctor = (): (new () => Recognition) | null => {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => Recognition) | null;
};

export const speechSupported = () => Ctor() !== null;

/**
 * `isSecureContext` is true on localhost as well as https, which is exactly the set
 * of origins recognition works on.
 */
export function speechState(): SpeechState {
  if (!speechSupported()) return 'unsupported';
  if (typeof window !== 'undefined' && window.isSecureContext === false) return 'insecure-context';
  return 'ok';
}

/** Message shown where the control is visible but cannot work. */
export const SPEECH_BLOCKED_MESSAGE =
  'Dictation needs a secure connection. Open the app over https, or on localhost, and it will work. Typing is unaffected.';

/**
 * Starts recognition and returns a stop function. `onText` receives the whole
 * transcript so far so a caller can render it live; `final` marks the point at
 * which the text will not change again.
 *
 * `continuous` is on: a brain dump is several sentences, and the default stops at
 * the first pause.
 */
export function listen(
  onText: (text: string, final: boolean) => void,
  onDone: (error?: string) => void,
): () => void {
  const C = Ctor();
  if (!C) {
    onDone('unsupported');
    return () => {};
  }
  const rec = new C();
  rec.lang = 'en-GB';
  rec.interimResults = true;
  rec.continuous = true;

  let settled = false;
  const settle = (error?: string) => {
    if (settled) return;
    settled = true;
    onDone(error);
  };

  // Finals are joined; only the newest interim is kept. Chrome on Android delivers each
  // revision of the sentence in progress as its own entry rather than updating one, so
  // joining everything concatenated every partial version and produced text like
  // "the voice is the voice is about the voice is about you". Interims are drafts of the
  // same words, not separate words.
  rec.onresult = (e) => {
    let settledText = '';
    let interim = '';
    for (let i = 0; i < e.results.length; i += 1) {
      const result = e.results[i];
      if (result.isFinal === true) settledText += `${result[0].transcript} `;
      else interim = result[0].transcript;
    }
    const text = `${settledText}${interim}`.replace(/\s+/g, ' ').trim();
    onText(text, interim === '');
  };
  rec.onerror = (e) => settle(e.error);
  rec.onend = () => settle();

  try {
    rec.start();
  } catch {
    settle('failed-to-start');
  }
  return () => rec.stop();
}
