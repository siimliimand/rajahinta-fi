'use client';

/**
 * AuthoritySourceLinks — the calculator surface's curated authority links,
 * beside the result totals (audit-copy-batch task 3.1, completed by
 * calculator-authority-links-completion).
 *
 * The declaration guidance panel's OFFICIAL_SOURCES set stays vero.fi-only
 * (Tax Administration filing context, pinned by test); this component
 * curates the broader consumer authority context for the calculator: the
 * two vero.fi guidance pages the panel renders, plus the official
 * traveller-duty calculator (vero.fi Alkoholiverolaskuri) and Finnish
 * Customs traveller guidance for alcohol imports.
 *
 * Every URL verified live 2026-10-16 (search-index verification; tulli.fi
 * 403s plain fetchers — CDN posture, same as Posti's documented block).
 * No URL is invented; new entries require verification first.
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
 * The calculator-surface authority links. Order: the declaration panel's
 * vero.fi guidance set first, then the traveller links the audit named.
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
  {
    labelKey: 'alcoholCalculator',
    url: 'https://www.vero.fi/henkiloasiakkaat/verokortti-ja-veroilmoitus/ulkomailta_suomeen/matkustajatuonti/alkoholiverolaskuri',
  },
  {
    labelKey: 'tulliTravellerGuidance',
    url: 'https://tulli.fi/rajoitukset/alkoholi/tuonti-matkalta',
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
