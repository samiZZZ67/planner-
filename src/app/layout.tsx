import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Night Planner - Clear Intentional Daily Planning',
  description: 'Personal offline-first night planner with YouTube Studio style analytics and automatic cloud sync.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Night Planner',
  },
};

export const viewport: Viewport = {
  themeColor: '#0a0b12',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="dark" className="h-full">
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
      </head>
      <body className="h-full overflow-x-hidden font-body antialiased selection:bg-purple-600 selection:text-white">
        {children}
      </body>
    </html>
  );
}
