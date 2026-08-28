import React from 'react';
import { render as rtlRender } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import fiMessages from '@/messages/fi.json';

/**
 * Render a component wrapped in the Finnish (default-locale) message
 * provider, mirroring what the [locale] layout does in the app.
 *
 * Component tests assert Finnish copy because Finnish is the source of
 * truth and the default locale.
 */
export function renderWithIntl(ui: React.ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="fi" messages={fiMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}
