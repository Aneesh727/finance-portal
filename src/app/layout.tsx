import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ToastProvider, ConfirmProvider } from '@/ui/kit';

export const metadata: Metadata = { title: { default: 'Finance Portal', template: '%s · Finance Portal' }, description: 'Project cost & profitability management', robots: { index: false, follow: false } };
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body>
        <ToastProvider>
          <ConfirmProvider>{children}</ConfirmProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
