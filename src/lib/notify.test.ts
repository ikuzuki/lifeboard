import { describe, expect, it } from 'vitest';
import { eveningText, morningText } from './notify';

/** The wording is assembled from counts alone, which is what keeps titles off the server. */
describe('digest wording', () => {
  it('leads with what was missed when anything was', () => {
    expect(morningText({ missed: 4, today: 2, thisWeek: 3 })).toEqual({
      title: '4 missed, 2 start today',
      body: '3 more start this week.',
    });
  });

  it('says nothing about missing anything on a clear morning', () => {
    expect(morningText({ missed: 0, today: 2, thisWeek: 0 })).toEqual({
      title: '2 to start today',
      body: 'Nothing else this week.',
    });
  });

  it('offers the two ways out in the evening', () => {
    expect(eveningText(3)).toEqual({
      title: '3 still open',
      body: 'Push them to tomorrow, or tick them off.',
    });
  });
});
