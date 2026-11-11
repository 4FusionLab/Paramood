import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Parameter } from './bridge';
import { nameInParameterGroup } from './parameter-tree';

type Preview = { group: string | null; name?: string; error?: string; source: string };
type Drag = { parameter: Parameter; pointerId: number; x: number; y: number; moved: boolean };

export function useParameterDrag(
  parameters: Parameter[],
  onRename: ((parameter: Parameter, name: string) => Promise<boolean>) | undefined,
  busy: boolean | undefined,
  editing: ComponentChildren,
) {
  const root = useRef<HTMLElement>(null);
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [revealGroup, setRevealGroup] = useState<{ path: string } | null>(null);

  useLayoutEffect(() => {
    function cancel() {
      if (drag.current?.moved) suppressClick.current = true;
      drag.current = null;
      setPreview(null);
    }
    function destination(event: PointerEvent, source: Drag): Preview {
      const target = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>('[data-parameter-group]');
      if (!target || !root.current?.contains(target) || target.closest('[inert]'))
        return { source: source.parameter.name, group: null };
      const group = target.dataset.parameterGroup!;
      try {
        const name = nameInParameterGroup(source.parameter.name, group);
        if (
          parameters.some(
            (parameter) =>
              parameter.name !== source.parameter.name &&
              parameter.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
          )
        )
          throw new Error(`A parameter named ${name} already exists.`);
        if (
          group === source.parameter.name.replaceAll('_', '.') ||
          group.startsWith(`${source.parameter.name.replaceAll('_', '.')}.`)
        )
          throw new Error('Choose a different group.');
        return { source: source.parameter.name, group, name };
      } catch (error) {
        return { source: source.parameter.name, group, error: (error as Error).message };
      }
    }
    function move(event: PointerEvent) {
      const source = drag.current;
      if (!source || source.pointerId !== event.pointerId) return;
      if (!source.moved && Math.hypot(event.clientX - source.x, event.clientY - source.y) < 5)
        return;
      source.moved = true;
      event.preventDefault();
      const pane = root.current?.closest<HTMLElement>('.list-pane');
      if (pane) {
        const bounds = pane.getBoundingClientRect();
        if (event.clientY < bounds.top + 24) pane.scrollTop -= 16;
        else if (event.clientY > bounds.bottom - 24) pane.scrollTop += 16;
      }
      setPreview(destination(event, source));
    }
    function finish(event: PointerEvent) {
      const source = drag.current;
      if (!source || source.pointerId !== event.pointerId) return;
      const target = source.moved ? destination(event, source) : null;
      cancel();
      if (!target) return;
      if (target.error) setError(target.error);
      else if (target.name && target.name !== source.parameter.name) {
        const current = parameters.find((parameter) => parameter.name === source.parameter.name);
        if (!current || current.entityToken !== source.parameter.entityToken || busy || editing)
          return;
        setRevealGroup({ path: target.group! });
        void onRename?.(current, target.name).catch((error: unknown) => {
          setError(error instanceof Error ? error.message : String(error));
        });
      }
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== 'Escape' || !drag.current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      cancel();
    }
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('lostpointercapture', cancel);
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', escape, true);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('lostpointercapture', cancel);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', escape, true);
      cancel();
    };
  }, [parameters, onRename, busy, editing]);

  return {
    root,
    preview,
    error,
    revealGroup,
    pointerDown(event: PointerEvent) {
      suppressClick.current = false;
      if (
        busy ||
        editing ||
        root.current?.querySelector('input.tree-name') ||
        !onRename ||
        event.button !== 0 ||
        event.isPrimary === false
      )
        return;
      const handle = (event.target as Element).closest<HTMLElement>('.tree-name-button');
      if (!handle || handle.closest('[inert]')) return;
      const name = handle.closest<HTMLElement>('[data-parameter-name]')?.dataset.parameterName;
      const parameter = parameters.find((item) => item.name === name);
      if (!parameter?.entityToken || parameter.driven) return;
      setError('');
      drag.current = {
        parameter,
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        moved: false,
      };
      handle.setPointerCapture?.(event.pointerId);
    },
    click(event: MouseEvent) {
      if (!suppressClick.current) return;
      suppressClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}
