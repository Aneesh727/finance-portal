'use client';
import { Lock } from 'lucide-react';
import { useSession } from '@/ui/session';

/** Renders children only when the user holds (any of) the permissions; otherwise a clear "no access" message. */
export function Guard({ any, children }: { any: string[]; children: React.ReactNode }) {
  const { canAny } = useSession();
  if (!canAny(...any)) return (
    <div className="mx-auto mt-16 flex max-w-sm flex-col items-center gap-2 text-center">
      <Lock className="h-8 w-8 text-ink-300" /><h2>You don’t have access to this page</h2>
      <p className="text-sm text-ink-500">Ask an administrator to grant the required permission if you need it.</p>
    </div>
  );
  return <>{children}</>;
}
