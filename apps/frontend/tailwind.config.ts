import type { Config } from 'tailwindcss';

/**
 * Theme values reference CSS variables defined in src/app/globals.css
 * (OpenSpec: design-system-foundation, D4). The literals live in one
 * place — `:root` — so a future dark theme overrides variables instead
 * of sweeping components.
 *
 * Status hue ladder (D1/D2): VERIFIED green, ESTIMATED blue, STALE amber,
 * UNAVAILABLE gray; `error` is red and reserved for errors and
 * destructive affordances. Each group exposes:
 *   <name>          solid hue — dots, icons, text on white, solid fills
 *   <name>-fg       text color on the tinted badge background
 *   <name>-bg       tinted badge background
 *   <name>-border   tinted badge border
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
        gray: {
          50: 'var(--gray-50)',
          100: 'var(--gray-100)',
          200: 'var(--gray-200)',
          300: 'var(--gray-300)',
          400: 'var(--gray-400)',
          500: 'var(--gray-500)',
          600: 'var(--gray-600)',
          700: 'var(--gray-700)',
          800: 'var(--gray-800)',
          900: 'var(--gray-900)',
          950: 'var(--gray-950)',
        },
        status: {
          verified: {
            DEFAULT: 'var(--status-verified)',
            fg: 'var(--status-verified-fg)',
            bg: 'var(--status-verified-bg)',
            border: 'var(--status-verified-border)',
          },
          estimated: {
            DEFAULT: 'var(--status-estimated)',
            fg: 'var(--status-estimated-fg)',
            bg: 'var(--status-estimated-bg)',
            border: 'var(--status-estimated-border)',
          },
          stale: {
            DEFAULT: 'var(--status-stale)',
            fg: 'var(--status-stale-fg)',
            bg: 'var(--status-stale-bg)',
            border: 'var(--status-stale-border)',
          },
          unavailable: {
            DEFAULT: 'var(--status-unavailable)',
            fg: 'var(--status-unavailable-fg)',
            bg: 'var(--status-unavailable-bg)',
            border: 'var(--status-unavailable-border)',
          },
        },
        error: {
          DEFAULT: 'var(--error)',
          fg: 'var(--error-fg)',
          bg: 'var(--error-bg)',
          border: 'var(--error-border)',
        },
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
      },
    },
  },
  plugins: [],
};

export default config;
