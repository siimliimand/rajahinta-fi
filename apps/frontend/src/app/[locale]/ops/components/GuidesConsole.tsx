'use client';

/**
 * GuidesConsole — the guide draft workflow (insight-surfaces 5.1, spec
 * guides-hub): create GUIDE drafts, edit them while DRAFT, and publish
 * through the blog publication gate. Guides carry no rate-version
 * provenance, so the forms deliberately offer no such field. Inline-copy
 * precedent of the moderation/newsletter consoles (console-ui), not
 * catalog keys.
 *
 * @module GuidesConsole
 */

import React, { useCallback, useState } from 'react';
import {
  OpsApiError,
  createGuideDraft,
  editGuideDraft,
  listBlogPosts,
  publishBlogPost,
  type OpsBlogPostItem,
} from '../api';
import { ConsoleSection, StatusBadge, consoleLabels, inputClass } from './console-ui';

export default function GuidesConsole({ locale }: { locale: string }) {
  const t = consoleLabels(locale, {
    fi: {
      title: 'Oppaat',
      intro:
        'Ikuiset oppaat (kind GUIDE) syntyvät ja julkaistaan täällä saman ihmisen luonnos–julkaisu-portin kautta kuin veromuutospostaukset. Oppailla ei ole veroversion alkuperätietoa. Luonnos ei näy julkisilla sivuilla ennen julkaisua, ja julkaisu vaatii sisältöpolitiikan tarkistuksen läpiviennin.',
      operator: 'Operaattori',
      token: 'Ops-tunnus (bearer)',
      load: 'Nouda oppaat',
      loading: 'Noudetaan…',
      createTitle: 'Uusi opasluonnos',
      slug: 'URL-tunnus (slug, a-z ja väliviivat)',
      localeLabel: 'Kieli',
      titleLabel: 'Otsikko',
      bodyLabel: 'Leipäteksti (markdown)',
      create: 'Luo luonnos',
      creating: 'Luodaan…',
      draftsTitle: 'Oppaat',
      noGuides: 'Ei oppaita vielä.',
      edit: 'Muokkaa',
      save: 'Tallenna',
      cancel: 'Peruuta',
      publish: 'Julkaise',
      publishedAt: 'julkaistu',
      actionFailed: 'Toiminto epäonnistui',
      createHint: 'Luonnos tallentuu kind GUIDE -rivinä ilman veroversion tietoa.',
      listIntro: 'Kaikki oppaat molemmilla kielillä, luonnokset ja julkaistut.',
    },
    en: {
      title: 'Guides',
      intro:
        'Evergreen guides (kind GUIDE) are created and published here through the same human draft-to-published gate as the rate-change posts. Guides carry no rate-dataset-version provenance. A draft is invisible publicly until published, and publication requires the body to pass the content-policy lint.',
      operator: 'Operator',
      token: 'Ops bearer token',
      load: 'Load guides',
      loading: 'Loading…',
      createTitle: 'New guide draft',
      slug: 'URL slug (a-z and hyphens)',
      localeLabel: 'Locale',
      titleLabel: 'Title',
      bodyLabel: 'Body (markdown)',
      create: 'Create draft',
      creating: 'Creating…',
      draftsTitle: 'Guides',
      noGuides: 'No guides yet.',
      edit: 'Edit',
      save: 'Save',
      cancel: 'Cancel',
      publish: 'Publish',
      publishedAt: 'published',
      actionFailed: 'Action failed',
      createHint: 'The draft is stored as a kind GUIDE row without rate-version provenance.',
      listIntro: 'All guides in both locales — drafts and published alike.',
    },
  });

  const [operator, setOperator] = useState('');
  const [token, setToken] = useState('');
  const [items, setItems] = useState<OpsBlogPostItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [slug, setSlug] = useState('');
  const [guideLocale, setGuideLocale] = useState<'fi' | 'en'>('fi');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [creating, setCreating] = useState(false);

  // The one draft being edited inline (id + current field values).
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');

  const ready = operator.trim() !== '' && token.trim() !== '';

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listBlogPosts(token, 'GUIDE');
      setItems(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.actionFailed);
    } finally {
      setLoading(false);
    }
  }, [t.actionFailed, token]);

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      await refresh();
    } catch (err) {
      setError(err instanceof OpsApiError || err instanceof Error ? err.message : t.actionFailed);
    }
  };

  const create = async () => {
    setCreating(true);
    await run(() =>
      createGuideDraft(token, {
        operator: operator.trim(),
        slug: slug.trim(),
        locale: guideLocale,
        title: title.trim(),
        bodyMarkdown: body,
      }),
    );
    setCreating(false);
    setSlug('');
    setTitle('');
    setBody('');
  };

  const guides = items ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-8 py-8">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">{t.title}</h1>
        <p className="mt-1 text-sm text-gray-600">{t.intro}</p>
      </header>

      <section className="rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-900">{t.operator} / {t.token}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-medium text-gray-700">
            {t.operator}
            <input
              type="text"
              value={operator}
              onChange={(e) => setOperator(e.target.value)}
              autoComplete="off"
              className={inputClass}
            />
          </label>
          <label className="block text-xs font-medium text-gray-700">
            {t.token}
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="off"
              className={inputClass}
            />
          </label>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={!ready || loading}
          className="mt-3 rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
        >
          {loading ? t.loading : t.load}
        </button>
        {error !== null && (
          <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </p>
        )}
      </section>

      <ConsoleSection title={t.createTitle} intro={t.createHint}>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-medium text-gray-700">
            {t.slug}
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="block text-xs font-medium text-gray-700">
            {t.localeLabel}
            <select
              value={guideLocale}
              onChange={(e) => setGuideLocale(e.target.value === 'en' ? 'en' : 'fi')}
              className={inputClass}
            >
              <option value="fi">fi</option>
              <option value="en">en</option>
            </select>
          </label>
          <label className="block text-xs font-medium text-gray-700 sm:col-span-2">
            {t.titleLabel}
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="block text-xs font-medium text-gray-700 sm:col-span-2">
            {t.bodyLabel}
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              className={inputClass}
            />
          </label>
        </div>
        <button
          type="button"
          onClick={create}
          disabled={
            !ready ||
            creating ||
            slug.trim() === '' ||
            title.trim() === '' ||
            body.trim() === ''
          }
          className="mt-3 rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
        >
          {creating ? t.creating : t.create}
        </button>
      </ConsoleSection>

      <ConsoleSection title={t.draftsTitle} intro={t.listIntro}>
        {guides.length === 0 && !loading && (
          <p className="mt-3 text-xs text-gray-500">{t.noGuides}</p>
        )}
        {guides.length > 0 && (
          <ul className="mt-3 space-y-2">
            {guides.map((guide) => (
              <li key={guide.id} className="rounded border border-gray-200 p-3 text-xs">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-gray-900">{guide.title}</p>
                    <p className="text-gray-500">
                      {guide.slug} · {guide.locale} · {guide.kind}
                    </p>
                    <p className="text-gray-400">
                      {guide.status === 'PUBLISHED' && guide.publishedAt !== null
                        ? `${t.publishedAt} ${guide.publishedAt}`
                        : guide.status}
                    </p>
                  </div>
                  <StatusBadge status={guide.status} />
                  <div className="flex gap-2">
                    {guide.status === 'DRAFT' && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(editingId === guide.id ? null : guide.id);
                            setEditTitle(guide.title);
                            setEditBody('');
                          }}
                          className="rounded bg-gray-600 px-2 py-1 font-medium text-white hover:bg-gray-700"
                        >
                          {editingId === guide.id ? t.cancel : t.edit}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            run(() =>
                              publishBlogPost(token, guide.id, {
                                operator: operator.trim(),
                              }),
                            )
                          }
                          className="rounded bg-green-600 px-2 py-1 font-medium text-white hover:bg-green-700"
                        >
                          {t.publish}
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {editingId === guide.id && (
                  <div className="mt-3 space-y-2">
                    <label className="block text-xs font-medium text-gray-700">
                      {t.titleLabel}
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className={inputClass}
                      />
                    </label>
                    <label className="block text-xs font-medium text-gray-700">
                      {t.bodyLabel}
                      <textarea
                        value={editBody}
                        onChange={(e) => setEditBody(e.target.value)}
                        rows={8}
                        className={inputClass}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        void run(() =>
                          editGuideDraft(token, guide.id, {
                            operator: operator.trim(),
                            ...(editTitle.trim() === '' ? {} : { title: editTitle.trim() }),
                            ...(editBody.trim() === '' ? {} : { bodyMarkdown: editBody }),
                          }),
                        ).then(() => setEditingId(null));
                      }}
                      disabled={!ready}
                      className="rounded bg-primary-600 px-3 py-1.5 font-medium text-white hover:bg-primary-700 disabled:opacity-50"
                    >
                      {t.save}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </ConsoleSection>
    </div>
  );
}
