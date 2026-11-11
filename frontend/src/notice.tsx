import { useEffect, useRef } from 'preact/hooks';
import { X } from 'lucide-preact';
import { motionAllowed } from './motion';

export function Notice({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  const element = useRef<HTMLDivElement>(null);
  const exit = useRef<Animation | null>(null);
  const fallback = useRef<number | undefined>(undefined);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  function close() {
    if (exit.current) return;
    const region = element.current;
    if (!motionAllowed(region)) {
      dismiss.current();
      return;
    }
    const current = getComputedStyle(region);
    const animation = region.animate(
      [
        { opacity: current.opacity, transform: current.transform },
        { opacity: 0, transform: 'translateY(-4px)' },
      ],
      { duration: 160, easing: 'ease-in', fill: 'forwards' },
    );
    exit.current = animation;
    const finish = () => {
      window.clearTimeout(fallback.current);
      animation.onfinish = null;
      dismiss.current();
    };
    animation.onfinish = finish;
    // Never leave a notification stuck if an embedded view suspends animation events.
    fallback.current = window.setTimeout(finish, 220);
  }

  useEffect(() => {
    const timer = window.setTimeout(close, 3500);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(fallback.current);
      if (exit.current) {
        exit.current.onfinish = null;
        exit.current.cancel();
      }
    };
  }, []);

  return (
    <div ref={element} class="notice" role="status">
      {text}
      <button class="icon" aria-label="Dismiss" onClick={close}>
        <X size={13} />
      </button>
    </div>
  );
}
