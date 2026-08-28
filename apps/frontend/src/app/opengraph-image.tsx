import { ImageResponse } from 'next/og';

/**
 * Open Graph image: the wordmark and the site's catalog description on
 * a white field (design.md: credibility and restraint over marketing
 * polish). Rendered at build with next/og's bundled default font —
 * Inter is deliberately NOT fetched here; a network-dependent build
 * asset would violate the no-fetch-at-build constraint.
 *
 * Satori supports inline styles only, so the token values from
 * globals.css are mirrored as literals below:
 *   gray-900 #111827  gray-600 #4b5563  gray-200 #e5e7eb
 *   primary-700 #1d4ed8
 * The descriptor reuses the exact fi Metadata.description string, not
 * new copy, so it stays inside the content-policy vocabulary. Finnish
 * is the site's primary locale (unprefixed paths).
 */
export const alt =
  'Rajahinta.fi — rajat ylittävien juomien hintaindeksi ja kokonaiskustannuslaskuri';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#ffffff',
        }}
      >
        {/* Square initial mark — same geometry as the Logo component. */}
        <div
          style={{
            height: 96,
            width: 96,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#1d4ed8',
            borderRadius: 6,
            color: '#ffffff',
            fontSize: 56,
            fontWeight: 700,
            lineHeight: 1,
            marginBottom: 40,
          }}
        >
          R
        </div>
        <div
          style={{
            display: 'flex',
            color: '#111827',
            fontSize: 88,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            lineHeight: 1.1,
          }}
        >
          Rajahinta<span style={{ color: '#1d4ed8' }}>.fi</span>
        </div>
        <div
          style={{
            height: 4,
            width: 72,
            backgroundColor: '#e5e7eb',
            marginTop: 36,
            marginBottom: 36,
          }}
        />
        <div
          style={{
            display: 'flex',
            color: '#4b5563',
            fontSize: 34,
            lineHeight: 1.4,
            textAlign: 'center',
            maxWidth: 900,
          }}
        >
          Rajat ylittävien juomien hintaindeksi ja kokonaiskustannuslaskuri
        </div>
      </div>
    ),
    { ...size },
  );
}
