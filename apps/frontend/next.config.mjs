import createNextIntlPlugin from 'next-intl/plugin';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
};

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

export default withNextIntl(nextConfig);

// OpenNext Cloudflare adapter (migrate-to-cloudflare task 5.1): integrates
// the `next dev` server with local Workers bindings via the platform
// proxy. No-op for `next build`/`next start` beyond the proxy setup the
// adapter performs itself; adapter-documented requirement for using
// bindings during local development (relevant from task 5.2 on).
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';
initOpenNextCloudflareForDev();