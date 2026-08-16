import type { Metadata } from 'next';
import { AgeGate } from './components/AgeGate';
import './globals.css';

export const metadata: Metadata = {
  title: 'Rajahinta.fi',
  description: 'Finnish cross-border beverage price index and landed-cost intelligence platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fi">
      <body>
        <AgeGate>{children}</AgeGate>
      </body>
    </html>
  );
}