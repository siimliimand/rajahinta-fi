/**
 * Locale negotiation matrix (change localize-fi-route-pathnames,
 * design D3) — the middleware contract pinned at the real stack.
 *
 * The matrix is the load-bearing external behavior of the localized
 * pathnames migration: segment vocabulary switched the Finnish URLs to
 * fi segments (/tuotteet …), and next-intl's wrong-locale-pathname rule
 * must redirect foreign-locale requests to the canonical localized URL
 * with 307 (temporary — locale-negotiated URLs must not be cached as
 * permanent moves). The no-signal case is the SEO property of the whole
 * design: Googlebot sends no Accept-Language and no cookie, so crawlers
 * are served the segment-owning Finnish page from the bare URL and index
 * it as the fi canonical.
 *
 * Cases 1–5 and the hreflang spot-check are REQUEST-level: the
 * negotiation happens in middleware before any page renders, so the
 * assertions only need status codes, the Location header, and the
 * server-rendered HTML — no browser page. They run through Playwright's
 * APIRequestContext (request.get with maxRedirects: 0 returns the raw
 * 307 instead of following it). A fresh request fixture carries no
 * cookies and sends no Accept-Language, which IS the crawler
 * simulation for the no-signal case; the localized-browser cases set
 * the header explicitly.
 *
 * The switcher case (design D5) is PAGE-level: it exercises the real
 * `router.replace(pathname, { locale })` flow in SiteHeader — the
 * switcher must land on the bare Finnish URL (localePrefix: 'as-needed'
 * keeps the default locale unprefixed) with the NEXT_LOCALE cookie
 * written client-side, so the choice persists without a middleware
 * bounce.
 *
 * @module LocaleNegotiationMatrix
 */

import {
  test,
  expect,
  type APIRequestContext,
  type APIResponse,
} from '@playwright/test';
import { COPY, acceptAgeGate } from './helpers';

/** Accept-Language of an English browser (Chrome's default ordering). */
const EN_BROWSER = 'en-US,en;q=0.9';
/** Accept-Language of a Finnish browser. */
const FI_BROWSER = 'fi-FI,fi;q=0.9';

/**
 * GET that stops at the first response — with maxRedirects: 0 the 307
 * itself is returned and never followed, which is what the matrix
 * asserts.
 */
function rawGet(
  request: APIRequestContext,
  path: string,
  headers?: Record<string, string>,
): Promise<APIResponse> {
  return request.get(path, { headers, maxRedirects: 0 });
}

/**
 * The redirect target as a pathname, relative or absolute. next-intl's
 * middleware builds the Location from the request URL, so the header's
 * form is an implementation detail — the canonical path is the contract.
 */
function redirectPathname(response: APIResponse, baseURL: string): string {
  const location = response.headers()['location'];
  expect(
    location,
    'a redirect response must carry a Location header',
  ).toBeTruthy();
  return new URL(location!, baseURL).pathname;
}

test.describe('locale negotiation matrix (design D3)', () => {
  test('/tuotteet with an English browser redirects to /en/products', async ({
    request,
    baseURL,
  }) => {
    const res = await rawGet(request, '/tuotteet', {
      'accept-language': EN_BROWSER,
    });
    expect(res.status()).toBe(307);
    expect(redirectPathname(res, baseURL!)).toBe('/en/products');
  });

  test('/tuotteet with a Finnish browser serves the Finnish page', async ({
    request,
  }) => {
    const res = await rawGet(request, '/tuotteet', {
      'accept-language': FI_BROWSER,
    });
    expect(res.status()).toBe(200);

    const html = await res.text();
    // The layout renders <html lang={locale}> server-side, and the
    // catalog heading is the fi segment's owner — both markers fail if
    // the middleware ever bargains /tuotteet away from Finnish.
    expect(html).toMatch(/<html[^>]*\blang="fi"/);
    expect(html).toMatch(
      new RegExp(`<h1[^>]*>\\s*${COPY.catalogHeading}\\s*</h1>`),
    );
  });

  test('/tuotteet with NO signals (crawler) serves the Finnish page', async ({
    request,
  }) => {
    // The load-bearing SEO property (design.md Context): Googlebot sends
    // no Accept-Language and no cookie — resolution falls through to the
    // default locale (fi) and crawlers get the segment-owning Finnish
    // page, never a redirect. The request fixture is exactly that
    // client: a fresh context (zero cookies) and no header override on
    // this call (APIRequestContext sends no Accept-Language).
    const res = await rawGet(request, '/tuotteet');
    expect(res.status()).toBe(200);

    const html = await res.text();
    expect(html).toMatch(/<html[^>]*\blang="fi"/);
    expect(html).toMatch(
      new RegExp(`<h1[^>]*>\\s*${COPY.catalogHeading}\\s*</h1>`),
    );
  });

  test('legacy /products redirects per the negotiated locale', async ({
    request,
    baseURL,
  }) => {
    // fi signals: the English segment is the wrong-locale pathname →
    // the bare Finnish canonical.
    const fi = await rawGet(request, '/products', {
      'accept-language': FI_BROWSER,
    });
    expect(fi.status()).toBe(307);
    expect(redirectPathname(fi, baseURL!)).toBe('/tuotteet');

    // en signals: bare /products resolves under the unprefixed default
    // locale, so the en canonical is the prefixed English URL.
    const en = await rawGet(request, '/products', {
      'accept-language': EN_BROWSER,
    });
    expect(en.status()).toBe(307);
    expect(redirectPathname(en, baseURL!)).toBe('/en/products');
  });

  test('NEXT_LOCALE cookie outranks accept-language on the bare root', async ({
    browser,
    baseURL,
  }) => {
    // Cookie precedence (design D5): an /en visitor's stored choice
    // must win over a later fi Accept-Language — bare / redirects to
    // the English home, not back to Finnish.
    const context = await browser.newContext({ baseURL });
    await context.addCookies([
      { name: 'NEXT_LOCALE', value: 'en', url: baseURL! },
    ]);

    const res = await context.request.get('/', {
      headers: { 'accept-language': FI_BROWSER },
      maxRedirects: 0,
    });
    expect(res.status()).toBe(307);
    expect(redirectPathname(res, baseURL!)).toBe('/en');

    await context.close();
  });

  test('/tuotteet pairs hreflang alternates with the English URL', async ({
    request,
  }) => {
    // Spot-check of the D6 metadata contract: the fi page's alternates
    // pair /en/products and keep x-default on the negotiating bare URL.
    const res = await rawGet(request, '/tuotteet', {
      'accept-language': FI_BROWSER,
    });
    expect(res.status()).toBe(200);
    const html = await res.text();

    // Attribute order inside a Next-generated link tag is an
    // implementation detail, and React serializes the attribute
    // camelCased (`hrefLang`) — collect whole tags and match the
    // hreflang name case-insensitively.
    const linkTags = html.match(/<link\b[^>]*>/g) ?? [];
    const alternateHref = (hreflang: string): string | undefined => {
      const tag = linkTags.find(
        (candidate) =>
          candidate.includes('rel="alternate"') &&
          new RegExp(`\\bhreflang="${hreflang}"`, 'i').test(candidate),
      );
      return tag?.match(/href="([^"]*)"/)?.[1];
    };

    // Alternate hrefs are absolute (Next metadata base), but compare
    // pathnames only — the origin is an environment detail.
    expect(new URL(alternateHref('en')!, res.url()).pathname).toBe(
      '/en/products',
    );
    expect(new URL(alternateHref('x-default')!, res.url()).pathname).toBe(
      '/tuotteet',
    );
  });
});

test.describe('locale switcher (design D5)', () => {
  test('/en/products → click FI → lands on bare /tuotteet with the cookie set', async ({
    page,
  }) => {
    // The gate sits on restricted content in both locales; accepting on
    // the fi front page (the suite's default locale) plants the
    // age_confirmed cookie so /en/products serves ungated.
    await acceptAgeGate(page);

    await page.goto('/en/products');
    await expect(page).toHaveURL(/\/en\/products$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(
      page.getByRole('heading', { name: 'Products', exact: true }),
    ).toBeVisible();

    // The header switcher (desktop testid; the -mobile twin only shows
    // under md) navigates through router.replace(pathname, { locale }),
    // which writes NEXT_LOCALE before navigating — the D5 pitfall fix.
    const fiSwitch = page.getByTestId('locale-switch-fi');
    await expect(fiSwitch).toBeVisible();
    await fiSwitch.click();

    // as-needed keeps the default locale unprefixed: bare /tuotteet,
    // never /fi/tuotteet.
    await expect(page).toHaveURL(/\/tuotteet$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'fi');
    await expect(
      page.getByRole('heading', { name: COPY.catalogHeading, exact: true }),
    ).toBeVisible();

    const nextLocale = (await page.context().cookies()).find(
      (cookie) => cookie.name === 'NEXT_LOCALE',
    );
    expect(nextLocale?.value).toBe('fi');
  });
});
