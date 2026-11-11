// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { ParameterList, expressionWithoutUnit } from './parameter-list';

afterEach(() => {
  document.body.innerHTML = '';
});
it('keeps a parent parameter editable while independently expanding its children', () => {
  const host = document.createElement('div');
  let selected = '';
  act(() =>
    render(
      <ParameterList
        parameters={[
          { name: 'caption', expression: "'Feeder'", value: 'Feeder', unit: 'Text' },
          { name: 'caption_variant', expression: "'Classic'", value: 'Classic', unit: 'Text' },
        ]}
        onDelete={() => {}}
        onEdit={(parameter) => {
          selected = parameter.name;
        }}
      />,
      host,
    ),
  );
  expect(host.querySelector('[aria-label="Edit value caption"]')?.textContent).toBe('Feeder');
  expect(host.querySelector('[aria-label="Edit value caption_variant"]')).toBeNull();
  act(() => (host.querySelector('[aria-label="Expand caption"]') as HTMLButtonElement).click());
  act(() =>
    (host.querySelector('[aria-label="Edit value caption_variant"]') as HTMLButtonElement).click(),
  );
  expect(selected).toBe('caption_variant');
  act(() => (host.querySelector('[aria-label="Collapse caption"]') as HTMLButtonElement).click());
  act(() => (host.querySelector('[aria-label="Edit value caption"]') as HTMLButtonElement).click());
  expect(selected).toBe('caption');
});
it('edits a literal radian expression in the parameter degree unit', () => {
  expect(
    expressionWithoutUnit({
      name: 'angle',
      expression: '1.0471975511965976 rad',
      value: '60 deg',
      unit: 'deg',
    }),
  ).toBe('60');
});
it('groups hierarchical user parameters before model parameters and edits a leaf', () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let selected = '';
  act(() =>
    render(
      <ParameterList
        parameters={[
          { name: 'd12', expression: '5 mm', value: '5 mm', unit: 'mm', kind: 'model' },
          {
            name: 'height',
            expression: '4 mm',
            value: '4 mm',
            unit: 'mm',
            kind: 'model',
            linked: true,
          },
          {
            name: 'box_inner_size',
            expression: '10 mm',
            value: '10 mm',
            unit: 'mm',
            kind: 'user',
            linked: true,
          },
        ]}
        onDelete={() => {}}
        onEdit={(p) => {
          selected = p.name;
        }}
      />,
      host,
    ),
  );
  expect(host.querySelector('[aria-label="Edit value d12"]')).toBeNull();
  expect(host.querySelector('[aria-label="Expand box"]')).not.toBeNull();
  act(() => (host.querySelector('[aria-label="Expand all groups"]') as HTMLButtonElement).click());
  expect(host.querySelectorAll('[aria-label="Linked to model"]')).toHaveLength(2);
  expect(host.textContent!.indexOf('height')).toBeLessThan(
    host.textContent!.indexOf('Model parameters'),
  );
  expect(host.querySelector('[aria-label="Edit value height"]')?.hasAttribute('disabled')).toBe(
    false,
  );
  act(() => (host.querySelector('[aria-label="Collapse box"]') as HTMLButtonElement).click());
  expect(host.textContent).not.toContain('size');
  act(() => (host.querySelector('[aria-label="Expand box"]') as HTMLButtonElement).click());
  act(() =>
    (host.querySelector('[aria-label="Edit value box_inner_size"]') as HTMLButtonElement).click(),
  );
  expect(selected).toBe('box_inner_size');
});

it('shows model expressions and makes driven dimensions read-only', () => {
  const host = document.createElement('div');
  act(() =>
    render(
      <ParameterList
        parameters={[
          { name: 'd1', expression: 'd_min', value: '20 mm', unit: 'mm', kind: 'model' },
          {
            name: 'd24',
            expression: '25 mm',
            value: '25 mm',
            unit: 'mm',
            kind: 'model',
            driven: true,
          },
        ]}
        onDelete={() => {}}
        onEdit={() => {}}
      />,
      host,
    ),
  );
  const modelHeading = Array.from(host.querySelectorAll('button')).find((button) =>
    button.textContent?.includes('Model parameters'),
  )!;
  expect(modelHeading.getAttribute('aria-expanded')).toBe('false');
  act(() => modelHeading.click());
  expect(host.textContent).toContain('20 (d_min)');
  expect(host.textContent).toContain('(25)');
  expect(host.querySelector('[aria-label="Edit value d24"]')).toBeNull();
});

it('renames a user parameter with its full hierarchical name', async () => {
  const host = document.createElement('div');
  let renamed = '';
  act(() =>
    render(
      <ParameterList
        parameters={[
          { name: 'box_width', expression: '10 mm', value: '10 mm', unit: 'mm', kind: 'user' },
        ]}
        onDelete={() => {}}
        onEdit={() => {}}
        onRename={async (_, name) => {
          renamed = name;
          return true;
        }}
      />,
      host,
    ),
  );
  act(() => (host.querySelector('[aria-label="Expand box"]') as HTMLButtonElement).click());
  const nameButton = host.querySelector(
    'button[aria-label="Rename box_width"]',
  ) as HTMLButtonElement;
  expect(nameButton.textContent).toBe('width');
  act(() => nameButton.click());
  const input = host.querySelector('input[aria-label="Rename box_width"]') as HTMLInputElement;
  expect(input.value).toBe('box_width');
  act(() => {
    input.value = 'box_length';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  expect(renamed).toBe('box_length');
});

it('opens rename for a named model parameter', () => {
  const host = document.createElement('div');
  act(() =>
    render(
      <ParameterList
        parameters={[
          { name: 'champher', expression: '5 mm', value: '5 mm', unit: 'mm', kind: 'model' },
        ]}
        onDelete={() => {}}
        onEdit={() => {}}
        onRename={async () => true}
      />,
      host,
    ),
  );
  const name = host.querySelector('button[aria-label="Rename champher"]') as HTMLButtonElement;
  expect(name).not.toBeNull();
  act(() => name.click());
  expect(host.querySelector('input[aria-label="Rename champher"]')).not.toBeNull();
});

it('sorts named parameters within each group by name or numeric value in either direction', () => {
  const host = document.createElement('div');
  const parameters = [
    { name: 'box_z', expression: '2 mm', value: '2 mm', unit: 'mm' },
    { name: 'box_a', expression: '10 mm', value: '10 mm', unit: 'mm' },
    { name: 'box_m', expression: '3 mm', value: '3 mm', unit: 'mm' },
  ];
  act(() =>
    render(<ParameterList parameters={parameters} onEdit={() => {}} onDelete={() => {}} />, host),
  );
  const labels = () =>
    Array.from(host.querySelectorAll('.tree-children .tree-name')).map((item) => item.textContent);
  expect(labels()).toEqual([]);
  act(() => (host.querySelector('[aria-label="Expand all groups"]') as HTMLButtonElement).click());
  expect(labels()).toEqual(['a', 'm', 'z']);
  const select = host.querySelector('select')!;
  act(() => {
    select.value = 'value';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(labels()).toEqual(['z', 'm', 'a']);
  act(() => (host.querySelector('[aria-label="Sort descending"]') as HTMLButtonElement).click());
  expect(labels()).toEqual(['a', 'm', 'z']);
  act(() => {
    select.value = 'name';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(labels()).toEqual(['z', 'm', 'a']);
});

it('only shows the featured section while at least one parameter is featured', () => {
  const host = document.createElement('div');
  const update = (favorite: boolean | undefined) =>
    act(() =>
      render(
        <ParameterList
          parameters={[{ name: 'width', expression: '10', value: '10', unit: '', favorite }]}
          onEdit={() => {}}
          onDelete={() => {}}
        />,
        host,
      ),
    );
  update(undefined);
  expect(host.querySelector('.featured-parameters')).toBeNull();
  update(false);
  expect(host.textContent).not.toContain('Featured parameters');
  update(true);
  expect(host.querySelector('.featured-parameters')?.textContent).toContain(
    'Featured parameters (1)',
  );
  update(false);
  expect(host.querySelector('.featured-parameters')).toBeNull();
  expect(host.querySelector('[aria-label="Edit value width"]')).not.toBeNull();
});

it('shows and toggles native favorites and collapses all groups', () => {
  const host = document.createElement('div');
  const selected: string[] = [];
  const parameters = [
    { name: 'box_width', expression: '10 mm', value: '10 mm', unit: 'mm', favorite: true },
    { name: 'height', expression: '2 mm', value: '2 mm', unit: 'mm', favorite: false },
  ];
  act(() =>
    render(
      <ParameterList
        parameters={parameters}
        onEdit={() => {}}
        onDelete={() => {}}
        onFavorite={(p) => selected.push(p.name)}
      />,
      host,
    ),
  );
  expect(host.querySelector('[aria-expanded="false"]')?.textContent).toContain(
    'Featured parameters (1)',
  );
  act(() => (host.querySelector('[aria-label="Expand all groups"]') as HTMLButtonElement).click());
  expect(host.querySelector('[aria-expanded="false"]')?.textContent).toContain(
    'Featured parameters (1)',
  );
  act(() => (host.querySelector('.featured-heading') as HTMLButtonElement).click());
  expect(host.querySelectorAll('[aria-label="Remove from featured box_width"]')).toHaveLength(2);
  act(() =>
    (host.querySelector('[aria-label="Add to featured height"]') as HTMLButtonElement).click(),
  );
  expect(selected).toEqual(['height']);
  act(() =>
    (host.querySelector('[aria-label="Collapse all groups"]') as HTMLButtonElement).click(),
  );
  expect(host.querySelector('[aria-label="Expand box"]')).not.toBeNull();
  expect(host.querySelector('[aria-expanded="true"]')?.textContent).toContain(
    'Featured parameters (1)',
  );
});

it('shows computed text while preserving its source expression for edits', () => {
  const parameter = {
    name: 'caption',
    unit: 'Text',
    valueType: 'text' as const,
    value: 'Computed body',
    expression: "prefix+'body'",
  };
  expect(expressionWithoutUnit(parameter)).toBe("prefix+'body'");
  const host = document.createElement('div');
  document.body.appendChild(host);
  act(() =>
    render(<ParameterList parameters={[parameter]} onEdit={() => {}} onDelete={() => {}} />, host),
  );
  expect(host.querySelector('[aria-label="Edit value caption"]')?.textContent).toBe(
    'Computed body',
  );
  expect(host.querySelector('.tree-unit')?.textContent).toBe('');
});

it('copies the full native reference from a nested row without editing the parameter', () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const copy = vi.fn();
  const edit = vi.fn();
  act(() =>
    render(
      <ParameterList
        parameters={[
          { name: 'box_inner_width', expression: '10 mm', value: 10, unit: 'mm' },
          { name: 'box_inner', expression: '5 mm', value: 5, unit: 'mm' },
        ]}
        onEdit={edit}
        onDelete={() => {}}
        onCopyReference={copy}
      />,
      host,
    ),
  );
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Expand all groups"]')!.click());
  const group = host.querySelector('[aria-label="Collapse box"]')!;
  const groupEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  act(() => void group.dispatchEvent(groupEvent));
  expect(groupEvent.defaultPrevented).toBe(false);
  expect(host.querySelector('[role="menu"]')).toBeNull();
  const row = host.querySelector('[data-parameter-name="box_inner_width"] .tree-name')!;
  const event = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: 1020,
    clientY: 760,
  });
  act(() => void row.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
  expect(host.querySelector('[role="menu"]')?.textContent).toContain('box_inner_width');
  act(() => host.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click());
  expect(copy).toHaveBeenCalledWith('box_inner_width');
  expect(edit).not.toHaveBeenCalled();
  expect(host.querySelector('[role="menu"]')).toBeNull();
  const parent = host.querySelector('[data-parameter-name="box_inner"] .tree-name')!;
  act(
    () =>
      void parent.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })),
  );
  act(() => host.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click());
  expect(copy).toHaveBeenLastCalledWith('box_inner');
  act(() => render(null, host));
});

it('dismisses the reference menu and preserves the text editor context menu', () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const copy = vi.fn();
  act(() =>
    render(
      <ParameterList
        parameters={[
          { name: 'd12', expression: '10 mm', value: 10, unit: 'mm', kind: 'model', driven: true },
          { name: 'width', expression: '10 mm', value: 10, unit: 'mm' },
        ]}
        onEdit={() => {}}
        onDelete={() => {}}
        onCopyReference={copy}
        editingName="width"
        editor={<input aria-label="Inline expression" />}
      />,
      host,
    ),
  );
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Expand all groups"]')!.click());
  const row = host.querySelector('[data-parameter-name="d12"] .tree-name')!;
  const open = () =>
    act(
      () =>
        void row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })),
    );
  open();
  act(
    () =>
      void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  );
  expect(host.querySelector('[role="menu"]')).toBeNull();
  open();
  act(() => void document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })));
  expect(host.querySelector('[role="menu"]')).toBeNull();
  open();
  act(() => void host.dispatchEvent(new Event('scroll')));
  expect(host.querySelector('[role="menu"]')).toBeNull();
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  act(() => void host.querySelector('input')!.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(false);
  expect(host.querySelector('[role="menu"]')).toBeNull();
  open();
  act(() => host.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click());
  expect(copy).toHaveBeenCalledWith('d12');
  act(() => render(null, host));
});
