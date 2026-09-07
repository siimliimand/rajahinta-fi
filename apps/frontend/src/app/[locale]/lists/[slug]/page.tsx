/**
 * Curated list page (task 7.3, change product-roadmap-phases-1-4) —
 * public SEO content at /lists/:slug, backed by
 * GET /api/v1/lists/:slug (contract committed in task 7.2).
 *
 * A server component so crawlers receive list-specific title and
 * description metadata plus CollectionPage/ItemList structured data in
 * the initial HTML. generateMetadata and the page body share the list
 * fetch per render pass — Next dedupes identical server fetches within
 * a render.
 *
 * Degradation semantics: a curated list is public SEO content. An
 * unavailable list (backend down, unexpected response) renders a
 * server-side "unavailable" state instead of the feature UI; an unknown
 * slug's HTML is replaced by not-found. The sitemap only advertises
 * list URLs the catalog publishes, so this state is reachable only by
 * direct URL or a list removed mid-revalidate — never by a crawler
 * following the sitemap.
 *
 * Evidence-link treatment (deviation note for task 10.3's architecture
 * update): the task text says "outbound links through the redirect
 * controller", but the offer-keyed redirect controller
 * (`/api/v1/outbound/:offerId`) requires a retail-offer id and evidence
 * links are arbitrary documentation URLs — no offerId exists to key a
 * redirect. Following the 6.4 ProductDupesPanel precedent, evidence
 * links render as direct external anchors with the app's outbound
 * treatment (new tab, `rel="nofollow noopener"`, no affiliate
 * parameters). Any generic (non-offer-keyed) redirect route is
 * api-worker scope, not this page's.
 *
 * Entry links: entries with a productId link to the local product page
 * (i18n Link); externalRef-only entries render without a local link per
 * the spec — the external reference is shown as the factual identifier.
 *
 * @module CuratedListPage
 */

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Card } from '@/components/ui';
import {
  buildCuratedListJsonLd,
  getServerCuratedList,
  type CuratedList,
} from '../curated-lists.server';

interface ListPageProps {
  params: Promise<{ locale: string; slug: string }>;
}

export async function generateMetadata({
  params,
}: ListPageProps): Promise<Metadata> {
  const { locale, slug } = await params;
  const t = await getTranslations({ locale, namespace: 'ListsPage' });

  // Unavailable list data (unknown slug, backend down) degrades to
  // generic metadata instead of erroring the response — the product-page
  // precedent. An unknown slug's HTML is replaced by not-found anyway.
  const outcome = await getServerCuratedList(slug);
  if (outcome.kind !== 'ok') {
    return {
      title: t('fallbackMetaTitle'),
      description: t('fallbackMetaDescription'),
    };
  }

  return {
    title: t('metaTitle', { title: outcome.list.title }),
    description: t('metaDescription', { title: outcome.list.title }),
  };
}

/** The feature-unavailable state (list fetch degraded server-side). */
function UnavailableState({
  title,
  body,
}: {
  readonly title: string;
  readonly body: string;
}) {
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <Card as="section" padding="lg" data-testid="lists-unavailable">
        <h1 className="mb-2 text-xl font-bold text-primary-700">{title}</h1>
        <p className="text-sm text-gray-500">{body}</p>
      </Card>
    </main>
  );
}

/** One published entry: the WHY first (mandatory rationale), then the
 * target link and the evidence links. */
function ListEntry({
  entry,
  rationaleLabel,
  productLinkLabel,
  externalRefLabel,
  evidenceLabel,
}: {
  readonly entry: CuratedList['entries'][number];
  readonly rationaleLabel: string;
  readonly productLinkLabel: string;
  readonly externalRefLabel: string;
  readonly evidenceLabel: string;
}) {
  return (
    <li
      data-testid="list-entry"
      className="border-b border-gray-100 pb-4 last:border-b-0 last:pb-0"
    >
      {/* The mandatory editorial justification — the entry's WHY. */}
      <p className="text-sm text-gray-700">
        <span className="font-medium text-gray-900">{rationaleLabel}:{' '}</span>
        {entry.rationale}
      </p>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        {entry.productId !== null ? (
          <Link
            href={`/products/${entry.productId}`}
            className="font-medium text-primary-700 hover:underline"
          >
            {productLinkLabel}
          </Link>
        ) : (
          <span
            data-testid="list-entry-external-ref"
            className="text-xs text-gray-400"
          >
            {externalRefLabel}: {entry.externalRef}
          </span>
        )}
      </div>

      {/* Evidence links: direct external anchors with the outbound
          treatment — see the link-treatment note in the module doc. */}
      <div className="mt-1.5 text-sm">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
          {evidenceLabel}
        </span>
        <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          {entry.evidenceLinks.map((link) => (
            <li key={link.url}>
              <a
                href={link.url}
                target="_blank"
                rel="nofollow noopener"
                className="text-primary-700 hover:underline"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </li>
  );
}

export default async function CuratedListPage({ params }: ListPageProps) {
  const { locale, slug } = await params;
  const t = await getTranslations({ locale, namespace: 'ListsPage' });

  // ── Fetch: not-found → the app's 404; other failures degrade ──
  const outcome = await getServerCuratedList(slug);
  if (outcome.kind === 'not-found') {
    notFound();
  }
  if (outcome.kind === 'unavailable') {
    return (
      <UnavailableState
        title={t('unavailableTitle')}
        body={t('unavailableBody')}
      />
    );
  }

  const list = outcome.list;
  const metaDescription = t('metaDescription', { title: list.title });
  const jsonLd = buildCuratedListJsonLd(list, locale, metaDescription);

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Structured data: CollectionPage + ItemList, factual URLs only. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <h1 className="mb-1 text-2xl font-bold text-primary-700">
        {list.title}
      </h1>
      <p className="mb-8 text-sm text-gray-500">{metaDescription}</p>

      {/* ── Curation criteria — why entries are not arbitrary ── */}
      <Card as="section" padding="lg" className="mb-8" data-testid="lists-criteria">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-gray-400">
          {t('criteriaTitle')}
        </h2>
        <p className="mb-3 text-xs text-gray-400">{t('criteriaIntro')}</p>
        <ol className="list-decimal space-y-1.5 pl-5">
          {list.criteria.map((criterion) => (
            <li key={criterion} className="text-sm text-gray-700">
              {criterion}
            </li>
          ))}
        </ol>
      </Card>

      {/* ── Published entries (or the explicit empty state) ── */}
      <Card as="section" padding="lg" data-testid="lists-entries">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-gray-400">
          {t('entriesTitle')}
        </h2>
        <p className="mb-4 text-xs text-gray-400">
          {t('entriesCount', { count: list.entries.length })}
        </p>

        {list.entries.length === 0 ? (
          <div data-testid="lists-empty">
            <p className="text-sm font-medium text-gray-700">
              {t('emptyTitle')}
            </p>
            <p className="mt-1 text-sm text-gray-500">{t('emptyBody')}</p>
          </div>
        ) : (
          <ol className="space-y-4">
            {list.entries.map((entry) => (
              <ListEntry
                key={entry.id}
                entry={entry}
                rationaleLabel={t('rationaleLabel')}
                productLinkLabel={t('productLinkLabel')}
                externalRefLabel={t('externalRefLabel')}
                evidenceLabel={t('evidenceLabel')}
              />
            ))}
          </ol>
        )}
      </Card>
    </main>
  );
}
