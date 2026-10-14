// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { Confirm } from './Confirm';

function mount(props: Parameters<typeof Confirm>[0]) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(<Confirm {...props} />));
  const click = (label: string) => {
    const button = [...container.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === label,
    );
    if (!button) throw new Error(`no button labelled ${label}`);
    act(() => button.click());
  };
  return { container, click, unmount: () => act(() => root.unmount()) };
}

const base = {
  title: 'Delete Pool membership?',
  confirmLabel: 'Delete',
  onConfirm: () => {},
  onCancel: () => {},
};

describe('Confirm', () => {
  it('states the question and what will happen', () => {
    const view = mount({ ...base, detail: 'This removes the record for good.' });

    const dialog = view.container.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-label')).toBe('Delete Pool membership?');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.textContent).toContain('This removes the record for good.');
    view.unmount();
  });

  it('only acts on the confirm button', () => {
    // The idiom this replaces swapped a label in place for a longer one, so the row reflowed
    // and slid the neighbouring control under the thumb. Here the two are separate targets.
    let confirmed = 0;
    let cancelled = 0;
    const view = mount({
      ...base,
      onConfirm: () => void confirmed++,
      onCancel: () => void cancelled++,
    });

    view.click('Cancel');
    expect({ confirmed, cancelled }).toEqual({ confirmed: 0, cancelled: 1 });

    view.click('Delete');
    expect({ confirmed, cancelled }).toEqual({ confirmed: 1, cancelled: 1 });
    view.unmount();
  });

  it('cancels when the backdrop is used', () => {
    let cancelled = 0;
    const view = mount({ ...base, onCancel: () => void cancelled++ });

    const backdrop = view.container.querySelector('button[aria-label="Cancel"]');
    act(() => (backdrop as HTMLButtonElement).click());

    expect(cancelled).toBe(1);
    view.unmount();
  });

  it('does not put focus on the destructive button', () => {
    // A stray Enter carried over from the control behind must not commit the action.
    const view = mount(base);

    const confirm = [...view.container.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Delete',
    );
    expect(document.activeElement).not.toBe(confirm);
    view.unmount();
  });
});
