// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { FindReferences, type ReferenceResults } from './find-references';
import { ParameterList } from './parameter-list';
import { request } from './bridge';
vi.mock('./bridge', () => ({ request: vi.fn() }));
const parameter = {
  name: 'width',
  expression: '10 mm',
  value: 10,
  unit: 'mm',
  entityToken: 'width',
  unused: true,
};
const result: ReferenceResults = {
  features: [
    {
      name: 'Extrude1',
      component: 'Root',
      kind: 'Feature',
      entityToken: 'extrude',
      uses: [
        {
          entityToken: 'd1',
          name: 'd1',
          expression: 'half',
          path: ['width', 'half', 'd1'],
          relation: 'Indirect',
        },
      ],
    },
  ],
  parameters: [],
  warnings: [],
};
let host: HTMLDivElement;
function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() => render(<FindReferences parameter={parameter} documentId="doc" />, host));
}
async function open() {
  await act(async () => (host.querySelector('button') as HTMLButtonElement).click());
}
afterEach(() => {
  if (host) act(() => render(null, host));
  document.body.innerHTML = '';
  vi.resetAllMocks();
});
it('loads, shows indirect paths and selects with document and parameter identity', async () => {
  vi.mocked(request).mockResolvedValueOnce(result).mockResolvedValueOnce({ selected: true });
  mount();
  await open();
  expect(request).toHaveBeenNthCalledWith(
    1,
    'parameters.references',
    { name: 'width', entityToken: 'width' },
    'doc',
  );
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('width → half → d1');
  await act(async () => document.querySelector<HTMLButtonElement>('.reference-feature')!.click());
  expect(request).toHaveBeenNthCalledWith(
    2,
    'parameters.references.select',
    { name: 'width', entityToken: 'width', targetToken: 'extrude' },
    'doc',
  );
  expect(document.querySelector('[role="status"]')?.textContent).toBe('Selected in Fusion');
  act(() => document.querySelector<HTMLButtonElement>('[aria-label="Close references"]')!.click());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(host.querySelector('button'));
});
it('ignores a late reply after switching documents', async () => {
  let resolve!: (value: ReferenceResults) => void;
  vi.mocked(request).mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r as typeof resolve;
      }),
  );
  mount();
  await open();
  act(() => render(<FindReferences parameter={parameter} documentId="other" />, host));
  await act(async () => resolve(result));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(request).toHaveBeenCalledTimes(1);
});
it('handles errors, empty results and Escape', async () => {
  vi.mocked(request).mockRejectedValueOnce(new Error('Finish the command'));
  mount();
  await open();
  await act(async () => {
    await Promise.resolve();
  });
  expect(document.querySelector('[role="alert"]')?.textContent).toBe('Finish the command');
  act(() => {
    document
      .querySelector('[role="dialog"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  vi.mocked(request).mockResolvedValueOnce({ features: [], parameters: [], warnings: [] });
  await open();
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    'No parameter or timeline references found.',
  );
});
it('marks only confirmed unused names and offers references for a read-only dimension', () => {
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() =>
    render(
      <ParameterList
        parameters={[parameter, { ...parameter, name: 'driven', driven: true, unused: false }]}
        documentId="doc"
        onDelete={() => {}}
        onEdit={() => {}}
      />,
      host,
    ),
  );
  expect(host.querySelector('.parameter-unused')?.textContent).toBe('width');
  expect(host.querySelectorAll('.parameter-unused')).toHaveLength(1);
  expect(host.querySelector('[aria-label="Find References driven"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="Edit value driven"]')).toBeNull();
});

it('drills into dependent parameters and navigates back through breadcrumbs', async () => {
  const dependent = {
    name: 'half_width',
    entityToken: 'half',
    expression: 'width / 2',
    path: ['width', 'half_width'],
    relation: 'Direct' as const,
  };
  vi.mocked(request)
    .mockResolvedValueOnce({ ...result, parameters: [dependent] })
    .mockResolvedValueOnce(result)
    .mockResolvedValueOnce({ ...result, parameters: [dependent] });
  mount();
  await open();
  await act(async () => document.querySelector<HTMLButtonElement>('.reference-parameter')!.click());
  expect(request).toHaveBeenNthCalledWith(
    2,
    'parameters.references',
    { name: 'half_width', entityToken: 'half' },
    'doc',
  );
  expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe(
    'Find References: half_width',
  );
  expect(document.querySelector('[aria-current="page"]')?.textContent).toBe('half_width');
  await act(async () =>
    document.querySelector<HTMLButtonElement>('.reference-breadcrumbs button')!.click(),
  );
  expect(request).toHaveBeenNthCalledWith(
    3,
    'parameters.references',
    { name: 'width', entityToken: 'width' },
    'doc',
  );
  expect(document.querySelector('.reference-breadcrumbs')).toBeNull();
});

it('clears an old selection confirmation when Fusion refuses a later selection', async () => {
  vi.mocked(request)
    .mockResolvedValueOnce(result)
    .mockResolvedValueOnce({ selected: true })
    .mockRejectedValueOnce(new Error('Finish the active command'));
  mount();
  await open();
  await act(async () => document.querySelector<HTMLButtonElement>('.reference-feature')!.click());
  expect(document.querySelector('[role="status"]')?.textContent).toBe('Selected in Fusion');
  await act(async () => document.querySelector<HTMLButtonElement>('.reference-feature')!.click());
  await act(async () => {
    await Promise.resolve();
  });
  expect(document.querySelector('[role="alert"]')?.textContent).toBe('Finish the active command');
  expect(document.querySelector('[role="status"]')?.textContent).toBe('');
  expect(document.querySelector('.reference-feature')?.getAttribute('aria-pressed')).toBe('false');
});
