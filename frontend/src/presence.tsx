import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Collapsible } from './collapsible';
import { motionAllowed } from './motion';

/** Retain an inert snapshot while an overlay fades out, without adding a layout box. */
export function Presence({ show, children }: { show: boolean; children: ComponentChildren }) {
  const [retained, setRetained] = useState(show);
  const root = useRef<HTMLDivElement>(null);
  const snapshot = useRef(children);
  if (show) snapshot.current = children;
  useLayoutEffect(() => {
    setRetained(show);
    const element = root.current?.firstElementChild as HTMLElement | null;
    if (show) return;
    if (!motionAllowed(element)) {
      snapshot.current = null;
      return;
    }
    setRetained(true);
    const animation = element.animate(
      [{ opacity: getComputedStyle(element).opacity }, { opacity: 0 }],
      {
        duration: 120,
        easing: 'ease-in',
        fill: 'forwards',
      },
    );
    const finish = () => {
      window.clearTimeout(fallback);
      animation.onfinish = null;
      snapshot.current = null;
      setRetained(false);
    };
    const fallback = window.setTimeout(finish, 180);
    animation.onfinish = finish;
    return () => {
      window.clearTimeout(fallback);
      animation.onfinish = null;
      animation.cancel();
    };
  }, [show]);
  return show || retained ? (
    <div ref={root} class="motion-presence" inert={!show} aria-hidden={!show}>
      {show ? children : snapshot.current}
    </div>
  ) : null;
}

/** Keep removed rows at their prior position until their height reaches zero. */
export function AnimatedList<T>({
  items,
  itemKey,
  children,
  class: className = 'parameter-entry',
  animate = true,
}: {
  items: T[];
  itemKey: (item: T) => string;
  children: (item: T) => ComponentChildren;
  class?: string;
  animate?: boolean;
}) {
  const records = useRef(new Map(items.map((item) => [itemKey(item), item])));
  const order = useRef(items.map(itemKey));
  const [, refresh] = useState(0);
  const live = new Set(items.map(itemKey));
  const current = useRef(live);
  current.current = live;
  const added = new Set(items.map(itemKey).filter((key) => !records.current.has(key)));
  const next = items.map(itemKey);
  order.current.forEach((key, index) => {
    if (!live.has(key) && records.current.has(key)) {
      if (animate) next.splice(Math.min(index, next.length), 0, key);
      else records.current.delete(key);
    }
  });
  order.current = next;
  items.forEach((item) => records.current.set(itemKey(item), item));

  return (
    <>
      {next.map((key) => (
        <Collapsible
          key={key}
          open={live.has(key)}
          animate={animate}
          animateOnMount={animate && added.has(key)}
          class={className}
          onExited={() => {
            if (current.current.has(key)) return;
            records.current.delete(key);
            refresh((version) => version + 1);
          }}
        >
          {children(records.current.get(key)!)}
        </Collapsible>
      ))}
    </>
  );
}
