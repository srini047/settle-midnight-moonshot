import type { Metadata } from 'next';
import { Syne, Figtree } from 'next/font/google';
import { Providers } from './providers';
import './globals.css';

const syne = Syne({
  subsets: ['latin'],
  variable: '--font-syne',
  weight: ['600', '700', '800'],
});

const figtree = Figtree({
  subsets: ['latin'],
  variable: '--font-figtree',
  weight: ['400', '500', '600', '700'],
});

export const metadata: Metadata = {
  title: 'Settle — shared negotiation table',
  description:
    'For two parties who cannot agree, Settle turns the argument into a live term sheet and an AI mediator that pushes them toward a deal.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${syne.variable} ${figtree.variable}`} style={{
        ['--font-display' as string]: 'var(--font-syne), system-ui, sans-serif',
        ['--font-body' as string]: 'var(--font-figtree), system-ui, sans-serif',
      }}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
