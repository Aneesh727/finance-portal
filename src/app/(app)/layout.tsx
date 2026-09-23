'use client';
import { SessionProvider } from '@/ui/session';
import { Shell } from '@/components/shell';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <SessionProvider><Shell>{children}</Shell></SessionProvider>;
}
