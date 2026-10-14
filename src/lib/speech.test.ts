import { afterEach, describe, expect, it, vi } from 'vitest';
import { listen, speechState, speechSupported } from './speech';

/**
 * jsdom has no SpeechRecognition, so the constructor is stubbed. The point of these
 * tests is the branch that decides between hiding the control and explaining it.
 */

class FakeRecognition {
  lang = '';
  interimResults = false;
  continuous = false;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  started = false;
  stopped = false;

  start() {
    this.started = true;
    FakeRecognition.last = this;
  }

  stop() {
    this.stopped = true;
  }

  static last: FakeRecognition | null = null;
}

const withRecognition = (secure: boolean) => {
  vi.stubGlobal('SpeechRecognition', FakeRecognition);
  vi.stubGlobal('isSecureContext', secure);
};

afterEach(() => {
  vi.unstubAllGlobals();
  FakeRecognition.last = null;
});

describe('speechState', () => {
  it('reports unsupported where the browser has no recognition at all', () => {
    expect(speechSupported()).toBe(false);
    expect(speechState()).toBe('unsupported');
  });

  it('reports insecure-context on a plain LAN address, so the reason can be shown', () => {
    withRecognition(false);
    expect(speechSupported()).toBe(true);
    expect(speechState()).toBe('insecure-context');
  });

  it('reports ok on a secure origin', () => {
    withRecognition(true);
    expect(speechState()).toBe('ok');
  });
});

describe('listen', () => {
  it('finishes with the unsupported reason instead of throwing', () => {
    const done = vi.fn();
    const stop = listen(() => {}, done);

    expect(done).toHaveBeenCalledWith('unsupported');
    expect(() => stop()).not.toThrow();
  });

  it('runs continuously, because a dump is more than one sentence', () => {
    withRecognition(true);
    listen(
      () => {},
      () => {},
    );

    expect(FakeRecognition.last?.continuous).toBe(true);
    expect(FakeRecognition.last?.interimResults).toBe(true);
  });

  it('reports the whole transcript so far, and marks it final only when it is', () => {
    withRecognition(true);
    const heard: { text: string; final: boolean }[] = [];
    listen((text, final) => heard.push({ text, final }), () => {});

    const rec = FakeRecognition.last!;
    rec.onresult?.({ results: [[{ transcript: 'book the' }]] });
    rec.onresult?.({
      results: Object.assign([Object.assign([{ transcript: 'book the dentist' }], { isFinal: true })]),
    });

    expect(heard[0]).toEqual({ text: 'book the', final: false });
    expect(heard[1]).toEqual({ text: 'book the dentist', final: true });
  });

  it('keeps only the newest draft when the engine sends each revision as its own entry', () => {
    // How Chrome on Android actually behaves, and what the single-entry fixture above never
    // exercised: every revision of the sentence in progress arrives as an extra entry rather
    // than replacing the previous one. Joining them all produced
    // "the voice is the voice is about the voice is about you" on a real device.
    withRecognition(true);
    const heard: { text: string; final: boolean }[] = [];
    listen((text, final) => heard.push({ text, final }), () => {});

    FakeRecognition.last!.onresult?.({
      results: [
        [{ transcript: 'the voice is' }],
        [{ transcript: 'the voice is about' }],
        [{ transcript: 'the voice is about you' }],
      ],
    });

    expect(heard[0]).toEqual({ text: 'the voice is about you', final: false });
  });

  it('keeps every settled phrase and appends the draft to them', () => {
    withRecognition(true);
    const heard: { text: string; final: boolean }[] = [];
    listen((text, final) => heard.push({ text, final }), () => {});

    const final = (t: string) => Object.assign([{ transcript: t }], { isFinal: true });
    FakeRecognition.last!.onresult?.({
      results: [final('book the dentist'), final('and ring the bank'), [{ transcript: 'about the exc' }]],
    });

    expect(heard[0]).toEqual({ text: 'book the dentist and ring the bank about the exc', final: false });
  });

  it('settles once, so a stop after an error does not fire twice', () => {
    withRecognition(true);
    const done = vi.fn();
    listen(() => {}, done);

    const rec = FakeRecognition.last!;
    rec.onerror?.({ error: 'not-allowed' });
    rec.onend?.();

    expect(done).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledWith('not-allowed');
  });
});
