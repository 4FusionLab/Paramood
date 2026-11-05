// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { ParameterList } from './parameter-list';

afterEach(() => {
  document.body.innerHTML = '';
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
  expect(host.textContent!.indexOf('box')).toBeLessThan(host.textContent!.indexOf('d12'));
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
