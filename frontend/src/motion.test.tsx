// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { ParameterList } from './parameter-list';
import { Notice } from './notice';
import { AnimatedList, Presence } from './presence';

let host: HTMLDivElement;
afterEach(() => {
  if (host) act(() => render(null, host));
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).animate;
  document.body.innerHTML = '';
});

function setup(motion = true) {
  vi.stubGlobal('matchMedia', () => ({ matches: motion }));
  const animations: Array<{ onfinish: (() => void) | null; cancel: ReturnType<typeof vi.fn> }> = [];
  const animate = vi.fn<HTMLElement['animate']>(() => {
    const animation = { onfinish: null, cancel: vi.fn() };
    animations.push(animation);
    return animation as unknown as Animation;
  });
  Object.defineProperty(HTMLElement.prototype, 'animate', {
    configurable: true,
    value: animate,
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  return { animate, animations };
}

it('highlights changes but keeps initial values and identical refreshes still', () => {
  const { animate, animations } = setup();
  function update(value: string, favorite = false) {
    act(() =>
      render(
        <ParameterList
          parameters={[{ name: 'width', expression: value, value, unit: 'mm', favorite }]}
          onEdit={() => {}}
          onDelete={() => {}}
          onFavorite={() => {}}
        />,
        host,
      ),
    );
  }
  update('10');
  update('10');
  expect(animate).not.toHaveBeenCalled();
  update('20');
  expect(animate).toHaveBeenCalledOnce();
  update('20', true);
  expect(animate).toHaveBeenCalledTimes(3);
  const reveal = animate.mock.contexts.findIndex(
    (element) => (element as HTMLElement).className === 'featured-reveal',
  );
  expect(reveal).toBeGreaterThanOrEqual(0);
  expect(animate.mock.calls[reveal][0]).toEqual([
    { height: '0px', opacity: '0' },
    { height: '0px', opacity: '1' },
  ]);
  update('20', true);
  expect(animate).toHaveBeenCalledTimes(3);
  expect(host.querySelector('.favorite')?.getAttribute('aria-pressed')).toBe('true');
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  update('30', false);
  expect(animate).toHaveBeenCalledTimes(3);
  act(() => render(null, host));
  expect(animations.every((animation) => animation.cancel.mock.calls.length === 1)).toBe(true);
});

it('animates only newly featured rows while the featured section is open', () => {
  const { animate } = setup();
  function update(secondFavorite: boolean) {
    act(() =>
      render(
        <ParameterList
          parameters={[
            { name: 'width', expression: '10', value: '10', unit: '', favorite: true },
            { name: 'height', expression: '20', value: '20', unit: '', favorite: secondFavorite },
          ]}
          onEdit={() => {}}
          onDelete={() => {}}
          onFavorite={() => {}}
        />,
        host,
      ),
    );
  }
  update(false);
  act(() => host.querySelector<HTMLButtonElement>('.featured-heading')!.click());
  expect(
    animate.mock.contexts.some(
      (element) => (element as HTMLElement).className === 'featured-entry',
    ),
  ).toBe(false);
  update(true);
  const entries = () =>
    animate.mock.contexts.filter(
      (element) => (element as HTMLElement).className === 'featured-entry',
    );
  expect(entries()).toHaveLength(1);
  update(true);
  expect(entries()).toHaveLength(1);
  expect(host.querySelectorAll('.featured-entry')).toHaveLength(2);
});

it('retains an inert row for deletion and cancels its exit when restored', () => {
  const { animations } = setup();
  const update = (items: string[]) =>
    act(() =>
      render(
        <AnimatedList items={items} itemKey={(item) => item}>
          {(item) => <button>{item}</button>}
        </AnimatedList>,
        host,
      ),
    );
  update(['width', 'height']);
  update(['height']);
  expect(host.querySelector('.parameter-entry[inert]')?.textContent).toBe('width');
  update(['width', 'height']);
  expect(animations[0].cancel).toHaveBeenCalledOnce();
  expect(animations[0].onfinish).toBeNull();
  update(['height']);
  act(() => animations[animations.length - 1].onfinish?.());
  expect(host.textContent).toBe('height');
});

it('fades an inert overlay snapshot and cancels pending exits on reopen', () => {
  const { animations } = setup();
  const update = (show: boolean) =>
    act(() =>
      render(<Presence show={show}>{show && <div role="dialog">Draft</div>}</Presence>, host),
    );
  update(true);
  update(false);
  expect(host.querySelector('.motion-presence[inert]')?.textContent).toBe('Draft');
  update(true);
  expect(animations[0].onfinish).toBeNull();
  expect(animations[0].cancel).toHaveBeenCalledOnce();
  update(false);
  act(() => animations[animations.length - 1].onfinish?.());
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});

it('keeps a dismissed toast visible until its exit animation ends', () => {
  vi.useFakeTimers();
  const { animations } = setup();
  const dismiss = vi.fn();
  act(() => render(<Notice text="Saved" onDismiss={dismiss} />, host));
  act(() => host.querySelector<HTMLButtonElement>('button')!.click());
  expect(dismiss).not.toHaveBeenCalled();
  expect(host.textContent).toContain('Saved');
  act(() => animations[0].onfinish?.());
  act(() => {
    vi.advanceTimersByTime(300);
  });
  expect(dismiss).toHaveBeenCalledOnce();
});

it('cancels an old toast exit and timers when a new toast replaces it', () => {
  vi.useFakeTimers();
  const { animations } = setup();
  const dismiss = vi.fn();
  act(() => render(<Notice key="old" text="Saved" onDismiss={dismiss} />, host));
  act(() => {
    vi.advanceTimersByTime(3500);
  });
  expect(animations).toHaveLength(1);
  act(() => render(<Notice key="new" text="Copied" onDismiss={dismiss} />, host));
  act(() => {
    vi.advanceTimersByTime(300);
  });
  expect(animations[0].onfinish).toBeNull();
  expect(animations[0].cancel).toHaveBeenCalledOnce();
  expect(dismiss).not.toHaveBeenCalled();
  expect(host.textContent).toContain('Copied');
});

it('dismisses immediately with reduced motion and has a fallback for suspended animations', () => {
  vi.useFakeTimers();
  const { animate } = setup(false);
  const dismiss = vi.fn();
  act(() => render(<Notice text="Saved" onDismiss={dismiss} />, host));
  act(() => host.querySelector<HTMLButtonElement>('button')!.click());
  expect(dismiss).toHaveBeenCalledOnce();
  expect(animate).not.toHaveBeenCalled();
  act(() => render(null, host));
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  dismiss.mockClear();
  act(() => render(<Notice text="Copied" onDismiss={dismiss} />, host));
  act(() => host.querySelector<HTMLButtonElement>('button')!.click());
  act(() => {
    vi.advanceTimersByTime(220);
  });
  expect(dismiss).toHaveBeenCalledOnce();
});

it.each([true, false])('keeps rapid add/remove/re-add consistent with motion=%s', (motion) => {
  const { animations } = setup(motion);
  const update = (items: string[]) =>
    act(() =>
      render(
        <AnimatedList items={items} itemKey={(item) => item}>
          {(item) => <button>{item}</button>}
        </AnimatedList>,
        host,
      ),
    );
  update([]);
  update(['width']);
  update([]);
  update(['width']);
  act(() => animations.forEach((animation) => animation.onfinish?.()));
  expect(host.querySelectorAll('button')).toHaveLength(1);
  expect(host.querySelector('[inert]')).toBeNull();
  update([]);
  act(() => animations.forEach((animation) => animation.onfinish?.()));
  expect(host.querySelector('button')).toBeNull();
  update(['width']);
  expect(host.querySelectorAll('button')).toHaveLength(1);
  expect(host.querySelector('[inert]')).toBeNull();
});

it('settles filtered rows immediately without remounting matches, then resumes ordinary motion', () => {
  const { animate, animations } = setup();
  const update = (items: string[], motion = true) =>
    act(() =>
      render(
        <AnimatedList items={items} itemKey={(item) => item} animate={motion}>
          {(item) => <button>{item}</button>}
        </AnimatedList>,
        host,
      ),
    );
  update(['width', 'height']);
  const width = host.querySelector('button');
  update(['width'], false);
  expect(host.textContent).toBe('width');
  expect(animate).not.toHaveBeenCalled();
  update(['width', 'height'], false);
  expect(host.querySelector('button')).toBe(width);
  expect(host.textContent).toBe('widthheight');
  expect(animate).not.toHaveBeenCalled();
  update(['width', 'height']);
  update(['width']);
  expect(animate).toHaveBeenCalledOnce();
  // Switching to a filter during an ordinary exit must cancel and settle it as well.
  update(['width'], false);
  expect(animations[0].cancel).toHaveBeenCalledOnce();
  expect(host.textContent).toBe('width');
});

it('animates parameter search in and out while keeping closing input inert', () => {
  const { animate, animations } = setup();
  act(() => render(<ParameterList parameters={[]} onEdit={() => {}} onDelete={() => {}} />, host));
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Show parameter search"]')!.click());
  const reveal = animate.mock.contexts.findIndex(
    (element) => (element as HTMLElement).className === 'parameter-search-reveal',
  );
  expect(reveal).toBeGreaterThanOrEqual(0);
  expect(document.activeElement).toBe(host.querySelector('[aria-label="Search parameters"]'));
  act(() => animations[reveal].onfinish?.());
  act(() =>
    host.querySelector<HTMLButtonElement>('[aria-label="Close parameter search"]')!.click(),
  );
  expect(host.querySelector('.parameter-search-reveal')?.hasAttribute('inert')).toBe(true);
  expect(document.activeElement).toBe(host.querySelector('[aria-label="Show parameter search"]'));
  act(() => animations[animations.length - 1].onfinish?.());
  expect(host.querySelector('[role="search"]')).toBeNull();
});
