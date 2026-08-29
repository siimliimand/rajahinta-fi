import React from 'react';

/**
 * Brand wordmark: "Rajahinta" set in the neutral ink with the ".fi"
 * domain suffix in the primary accent — the same name the site header
 * and metadata title use. Typographic on purpose: this is a credible
 * data tool, not a shop, so the mark is a rounded square carrying the
 * initial rather than an illustrated glyph.
 *
 * Server-compatible (no hooks, no client directives) so the header can
 * render it in the SSR payload. Font size inherits from context; color
 * is fixed for the light chrome per the WCAG AA pass in the design
 * change (gray-900 on white 17.4:1, primary-700 on white 6.7:1).
 */
type LogoProps = {
  className?: string;
  /** Render the square initial mark; false gives the bare wordmark. */
  showMark?: boolean;
};

export default function Logo({ className = '', showMark = true }: LogoProps) {
  return (
    <span className={`inline-flex items-center gap-[0.4em] ${className}`}>
      {showMark && (
        <span
          aria-hidden="true"
          className="flex h-[1.6em] w-[1.6em] items-center justify-center rounded-sm bg-primary-700 text-[0.95em] font-bold leading-none text-white"
        >
          R
        </span>
      )}
      <span className="font-bold tracking-tight text-gray-900">
        Rajahinta<span className="text-primary-700">.fi</span>
      </span>
    </span>
  );
}
