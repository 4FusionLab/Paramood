import { useLayoutEffect, useRef } from 'preact/hooks';

export function motionAllowed(element: HTMLElement | null): element is HTMLElement {
  return (
    !!element?.animate && !!window.matchMedia?.('(prefers-reduced-motion: no-preference)').matches
  );
}

export function useChangeMotion<T extends HTMLElement = HTMLDivElement>(
  value: string | boolean,
  keyframes: Keyframe[],
  duration: number,
) {
  const element = useRef<T>(null);
  const previous = useRef(value);
  useLayoutEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    if (!motionAllowed(element.current)) return;
    const animation = element.current.animate(keyframes, {
      duration,
      easing: 'ease-out',
    });
    return () => animation.cancel();
  }, [value]);
  return element;
}

export const valueHighlight: Keyframe[] = [
  { backgroundColor: 'var(--change-highlight)' },
  { backgroundColor: 'transparent' },
];

export const favoriteFeedback: Keyframe[] = [
  { transform: 'scale(1)' },
  { transform: 'scale(1.2)', offset: 0.4 },
  { transform: 'scale(1)' },
];
