/**
 * WhatIfForm row-cap disclosures (audit-copy-batch task 2.2, spec
 * web-application "Tool-limit disclosure").
 *
 * The scenario cap is 20 rows (DRAFT_BOUNDS.maxProducts, mirroring the
 * API's zod schema). The form names the remaining row capacity from
 * four free rows onward (16/20 … 19/20); at the cap the disclosure
 * names the constraint and points at the scenario's own alternative
 * affordance — sharing the finished scenario as a link. The cap's
 * reason is deliberately not stated: the disclosure never asserts a
 * reason the platform has not documented.
 *
 * @module WhatIfFormCapTest
 */
// @vitest-environment jsdom

import React from 'react';
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import WhatIfForm from './WhatIfForm';
import { newProductDraft } from '../scenario-draft';
import type { ProductDraft } from '../scenario-draft';
import { renderWithIntl } from '@/lib/testing/test-intl';

function rows(count: number): ProductDraft[] {
  return Array.from({ length: count }, (_, i) =>
    newProductDraft(`product-${i + 1}`),
  );
}

function renderForm(rowCount: number) {
  return renderWithIntl(
    <WhatIfForm
      rate={20}
      rows={rows(rowCount)}
      invalidNotice={false}
      throttled={false}
      onRateChange={vi.fn()}
      onRowChange={vi.fn()}
      onAddRow={vi.fn()}
      onRemoveRow={vi.fn()}
      onRecalculate={vi.fn()}
    />,
  );
}

describe('WhatIfForm row-cap disclosures (audit-copy-batch 2.2)', () => {
  it('stays quiet at 15 of 20 rows — the hint starts at the four-row window', () => {
    renderForm(15);

    expect(screen.queryByTestId('what-if-cap-proximity')).toBeNull();
    expect(screen.queryByTestId('what-if-cap-reached')).toBeNull();
  });

  it('names the remaining capacity from 16 of 20 rows', () => {
    renderForm(16);

    expect(screen.getByTestId('what-if-cap-proximity')).toHaveTextContent(
      'Tuoterivejä 16/20 — 4 paikkaa jäljellä.',
    );
    // Below the cap the at-limit block stays out.
    expect(screen.queryByTestId('what-if-cap-reached')).toBeNull();
  });

  it('uses the singular for the one remaining row at 19 of 20', () => {
    renderForm(19);

    expect(screen.getByTestId('what-if-cap-proximity')).toHaveTextContent(
      'Tuoterivejä 19/20 — 1 paikka jäljellä.',
    );
  });

  it('at the 20-row cap names the constraint and the share alternative', () => {
    renderForm(20);

    const cap = screen.getByTestId('what-if-cap-reached');
    expect(cap).toHaveTextContent('Skenaariossa voi olla enintään 20 tuotetta.');
    expect(cap).toHaveTextContent(
      'Valmiin skenaarion voi jakaa linkkinä tulosten yhteydessä.',
    );
    // The proximity hint yields to the at-limit disclosure.
    expect(screen.queryByTestId('what-if-cap-proximity')).toBeNull();
    // The add-row control is genuinely disabled at the cap.
    expect(
      screen.getByRole('button', { name: 'Lisää tuoterivi' }),
    ).toBeDisabled();
  });
});
