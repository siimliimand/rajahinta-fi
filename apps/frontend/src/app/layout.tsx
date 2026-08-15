import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Rajahinta.fi',
  description: 'Finnish cross-border beverage price index and landed-cost intelligence platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fi">
      <body>{children}</body>
    </html>
  );
}