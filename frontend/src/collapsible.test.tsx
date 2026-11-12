// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Collapsible } from './collapsible';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

function setup(motion = true) {
  vi.stubGlobal('matchMedia', () => ({ matches: motion }));
  const animations: Array<{
    onfinish: (() => void) | null;
    playState: string;
    cancel: ReturnType<typeof vi.fn>;
  }> = [];
  const animate = vi.fn<HTMLElement['animate']>(() => {
    const animation = { onfinish: null, playState: 'running', cancel: vi.fn() };
    animations.push(animation);
    return animation as unknown as Animation;
  });
  Object.defineProperty(HTMLElement.prototype, 'animate', {
    configurable: true,
    value: animate,
  });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const show = (open: boolean, motion = true) =>
    act(() =>
      render(
        <Collapsible open={open} animate={motion}>
          <button>Parameter</button>
        </Collapsible>,
        host,
      ),
    );
  const finish = () =>
    act(() => {
      const animation = animations[animations.length - 1];
      animation.playState = 'finished';
      animation.onfinish?.();
    });
  return { host, show, animate, animations, finish };
}

afterEach(() => {
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).animate;
});

it('retains inert children during collapse and removes them when finished', () => {
  const { host, show, animate, finish } = setup();
  show(true);
  expect(animate).not.toHaveBeenCalled();
  show(false);
  expect(host.querySelector('button')).not.toBeNull();
  expect(host.firstElementChild?.hasAttribute('inert')).toBe(true);
  expect(host.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  finish();
  expect(host.querySelector('button')).toBeNull();
  show(true);
  expect(host.querySelector('button')).not.toBeNull();
  finish();
  expect((host.firstElementChild as HTMLElement).style.overflow).toBe('');
});

it('reverses from the visible height and cancels animations on unmount', () => {
  const { host, show, animate, animations } = setup();
  show(true);
  const region = host.firstElementChild as HTMLElement;
  vi.spyOn(region, 'getBoundingClientRect').mockReturnValue({ height: 37 } as DOMRect);
  show(false);
  show(true);
  expect(animations[0].cancel).toHaveBeenCalledOnce();
  expect(animations[0].onfinish).toBeNull();
  expect(animate.mock.calls[1][0]).toEqual([
    { height: '37px', opacity: '' },
    { height: '0px', opacity: '1' },
  ]);
  act(() => render(null, host));
  expect(animations[1].cancel).toHaveBeenCalledOnce();
});

it('removes collapsed children immediately with reduced motion', () => {
  const { host, show, animate } = setup(false);
  show(true);
  show(false);
  expect(host.querySelector('button')).toBeNull();
  expect(animate).not.toHaveBeenCalled();
});

it('settles an interrupted opening when motion is disabled and resumes later toggles', () => {
  const { host, show, animate, animations } = setup();
  show(false);
  show(true);
  expect(animate).toHaveBeenCalledOnce();
  show(true, false);
  expect(animations[0].cancel).toHaveBeenCalledOnce();
  expect(host.querySelector('button')).not.toBeNull();
  expect((host.firstElementChild as HTMLElement).style.overflow).toBe('');
  show(false, false);
  expect(host.querySelector('button')).toBeNull();
  expect(animate).toHaveBeenCalledOnce();
  show(true, false);
  show(true);
  show(false);
  expect(animate).toHaveBeenCalledTimes(2);
});
