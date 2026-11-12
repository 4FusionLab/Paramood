import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';

export function Collapsible({
  open,
  children,
  class: className = '',
  animateOnMount = false,
  animate = true,
  onExited,
}: {
  open: boolean;
  children: ComponentChildren;
  class?: string;
  animateOnMount?: boolean;
  animate?: boolean;
  onExited?: () => void;
}) {
  const [retained, setRetained] = useState(open);
  const element = useRef<HTMLDivElement>(null);
  const previousOpen = useRef(animateOnMount ? false : open);
  const interrupted = useRef<{ height: number; opacity: string } | null>(null);
  const exited = useRef(onExited);
  exited.current = onExited;

  useLayoutEffect(() => {
    if (previousOpen.current === open && animate) return;
    previousOpen.current = open;
    const region = element.current;
    if (!region) return;
    setRetained(open);
    if (
      !animate ||
      !region.animate ||
      !window.matchMedia?.('(prefers-reduced-motion: no-preference)').matches
    ) {
      interrupted.current = null;
      if (!open) exited.current?.();
      return;
    }
    // Retain closing children until the animation ends; reverse from the visible height.
    if (!open) setRetained(true);
    const start = interrupted.current;
    interrupted.current = null;
    region.style.overflow = 'hidden';
    const animation = region.animate(
      [
        {
          height: `${start?.height ?? (open ? 0 : region.scrollHeight)}px`,
          opacity: start?.opacity ?? (open ? '0' : '1'),
        },
        { height: `${open ? region.scrollHeight : 0}px`, opacity: open ? '1' : '0' },
      ],
      { duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
    );
    const finish = () => {
      window.clearTimeout(fallback);
      animation.onfinish = null;
      region.style.overflow = '';
      setRetained(open);
      if (!open) exited.current?.();
    };
    const fallback = window.setTimeout(finish, 220);
    animation.onfinish = finish;
    return () => {
      window.clearTimeout(fallback);
      if (animation.playState === 'running') {
        interrupted.current = {
          height: region.getBoundingClientRect().height,
          opacity: getComputedStyle(region).opacity,
        };
      }
      animation.onfinish = null;
      animation.cancel();
      region.style.overflow = '';
    };
  }, [open, animate]);

  return open || retained ? (
    <div ref={element} class={className} inert={!open} aria-hidden={!open}>
      {children}
    </div>
  ) : null;
}
