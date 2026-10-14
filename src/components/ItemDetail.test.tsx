// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { ItemDetail } from './ItemDetail';
import { newItem, StoreContext, type Action } from '../store';
import type { State } from '../types';

function mount(title: string) {
  const item = newItem({ id: 'i1', title });
  const state: State = { reviewDeferredOn: null, items: [item], goals: [], version: 11 };
  const sent: Action[] = [];
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <StoreContext.Provider value={{ state, dispatch: (a) => sent.push(a) }}>
        <ItemDetail item={item} onClose={() => {}} />
      </StoreContext.Provider>,
    ),
  );

  const box = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Name"]');
  if (!box) throw new Error('no name field');
  // React tracks the value on the node itself, so a plain assignment looks like no change.
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  const type = (text: string) => {
    act(() => {
      setValue.call(box, text);
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const blur = () =>
    act(() => {
      box.focus();
      box.blur();
    });
  return { box, type, blur, sent, unmount: () => act(() => root.unmount()) };
}

describe('ItemDetail name', () => {
  it('renames the item on blur, trimmed', () => {
    const { box, type, blur, sent, unmount } = mount('Book dentst');
    type('  Book dentist  ');
    expect(sent).toHaveLength(0);
    blur();
    expect(sent).toEqual([{ type: 'patch', id: 'i1', patch: { title: 'Book dentist' } }]);
    expect(box.value).toBe('Book dentist');
    unmount();
  });

  it('puts the name back rather than leaving the item nameless', () => {
    const { box, type, blur, sent, unmount } = mount('Book dentist');
    type('   ');
    blur();
    expect(sent).toEqual([]);
    expect(box.value).toBe('Book dentist');
    unmount();
  });

  it('says nothing when the name is unchanged', () => {
    const { blur, sent, unmount } = mount('Book dentist');
    blur();
    expect(sent).toEqual([]);
    unmount();
  });
});
