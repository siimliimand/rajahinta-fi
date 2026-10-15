'use client';

/**
 * AuthoritySourceLinks — the declaration guidance panel's permanent
 * official-source link set, surfaced beside the calculator result totals
 * (audit-copy-batch task 3.1).
 *
 * The URLs are the API's OFFICIAL_SOURCES set
 * (packages/core-domain/src/declaration/excise-declaration.service.ts) —
 * the same two vero.fi links DeclarationGuidancePanel renders in its
 * "official sources" section, mirrored verbatim. No URL is invented here;
 * if the official set grows, this mirror and the API move together.
 *
 * Informational only: the links guide verification against the authorities
 * and imply no guidance, filing, or computation of their own.
 *
 * @module AuthoritySourceLinks
 */

import * as React from 'react';
import { useTranslations } from 'next-intl';

/** One authority link — label from the message catalog, URL from the set. */
interface AuthoritySource {
  readonly labelKey: string;
  readonly url: string;
}

/**
 * The declaration guidance panel's permanent official-source links.
 * Order matches the API's OFFICIAL_SOURCES array.
 */
const AUTHORITY_SOURCES: readonly AuthoritySource[] = [
  {
    labelKey: 'alcoholExcise',
    url: 'https://www.vero.fi/yritykset-ja-yhteisot/verot-ja-maksut/valmisterverot/alkoholi/',
  },
  {
    labelKey: 'exciseDuties',
    url: 'https://www.vero.fi/yritykset-ja-yhteisot/verot-ja-maksut/valmisterverot/',
  },
];

/**
 * The two official-source links rendered as one calm line directly under
 * the result totals. Same anchor conventions as the guidance panel's
 * sources section: new tab, noopener, primary underline.
 */
export default function AuthoritySourceLinks() {
  const t = useTranslations('AuthorityLinks');
  return (
    <div data-testid="authority-source-links" className="text-xs">
      <span className="font-semibold uppercase tracking-wide text-gray-400">
        {t('heading')}
      </span>{' '}
      {AUTHORITY_SOURCES.map((source, i) => (
        <React.Fragment key={source.url}>
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-600 underline hover:text-primary-800"
          >
            {t(source.labelKey)}
          </a>
          {i < AUTHORITY_SOURCES.length - 1 ? ' · ' : ''}
        </React.Fragment>
      ))}
    </div>
  );
}
