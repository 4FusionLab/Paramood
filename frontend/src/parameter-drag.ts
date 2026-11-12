import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Parameter } from './bridge';
import { nameInParameterGroup, parameterGroupMembers } from './parameter-tree';

type Preview = { group: string | null; name?: string; error?: string; source: string };
type Drag = {
  name: string;
  parameter?: Parameter;
  members?: Parameter[];
  pointerId: number;
  x: number;
  y: number;
  moved: boolean;
};

export function useParameterDrag(
  parameters: Parameter[],
  onRename: ((parameter: Parameter, name: string) => Promise<boolean>) | undefined,
  busy: boolean | undefined,
  editing: ComponentChildren,
  onRenameGroup?: (group: string, newGroup: string) => Promise<boolean>,
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
        return { source: source.name, group: null };
      const group = target.dataset.parameterGroup!;
      try {
        if (
          group === source.name.replaceAll('_', '.') ||
          group.startsWith(`${source.name.replaceAll('_', '.')}.`)
        )
          throw new Error('Choose a different group.');
        const name = nameInParameterGroup(source.name, group);
        if (source.members) {
          if (name !== source.name) {
            const prefix = name.toLocaleLowerCase();
            if (
              parameters.some(
                (p) =>
                  p.name.toLocaleLowerCase() === prefix ||
                  p.name.toLocaleLowerCase().startsWith(`${prefix}_`),
              )
            )
              throw new Error(`A group or parameter named ${name} already exists.`);
          }
          return { source: source.name, group, name };
        }
        if (
          parameters.some(
            (parameter) =>
              parameter.name !== source.name &&
              parameter.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
          )
        )
          throw new Error(`A parameter named ${name} already exists.`);
        return { source: source.name, group, name };
      } catch (error) {
        return { source: source.name, group, error: (error as Error).message };
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
      else if (target.name && target.name !== source.name) {
        if (busy || editing) return;
        let result: Promise<boolean> | undefined;
        if (source.members) {
          const members = parameterGroupMembers(parameters, source.name);
          if (
            members.length !== source.members.length ||
            members.some(
              (p, i) =>
                p.name !== source.members![i].name ||
                p.entityToken !== source.members![i].entityToken ||
                p.expression !== source.members![i].expression ||
                p.unit !== source.members![i].unit ||
                p.driven,
            )
          )
            return;
          result = onRenameGroup?.(source.name, target.name);
        } else {
          const current = parameters.find((parameter) => parameter.name === source.name);
          if (!current || current.entityToken !== source.parameter?.entityToken) return;
          result = onRename?.(current, target.name);
        }
        void result
          ?.then((ok) => {
            if (ok) setRevealGroup({ path: target.group! });
          })
          .catch((error: unknown) => {
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
  }, [parameters, onRename, onRenameGroup, busy, editing]);

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
        (!onRename && !onRenameGroup) ||
        event.button !== 0 ||
        event.isPrimary === false
      )
        return;
      const handle = (event.target as Element).closest<HTMLElement>('.tree-name-button');
      if (!handle || handle.closest('[inert]')) return;
      const row = handle.closest<HTMLElement>('.tree-row');
      const group = row?.dataset.parameterGroup;
      const name = group?.replaceAll('.', '_') || row?.dataset.parameterName;
      if (!name) return;
      const members =
        group !== undefined && onRenameGroup ? parameterGroupMembers(parameters, name) : undefined;
      const parameter = members ? undefined : parameters.find((item) => item.name === name);
      if (members) {
        if (!members.length || members.some((p) => !p.entityToken || p.driven)) {
          setError('Every parameter in this group must be editable before moving it.');
          return;
        }
      } else if (!onRename || !parameter?.entityToken || parameter.driven) return;
      setError('');
      drag.current = {
        name,
        members,
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
