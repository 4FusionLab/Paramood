// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { ParameterList, expressionWithoutUnit } from './parameter-list';

afterEach(() => {
  document.body.innerHTML = '';
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
