'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Landmark } from 'lucide-react';
import { api, ApiFail } from '@/ui/api';
import { Button, ErrorBox, Field, Input } from '@/ui/kit';

function LoginForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiFail | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    api.get<{ needsSetup: boolean }>('/api/setup/status').then((r) => { if (r.data.needsSetup) router.replace('/setup'); else setChecking(false); }).catch(() => setChecking(false));
  }, [router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await api.post('/api/auth/login', { email, password });
      const next = sp.get('next');
      router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : '/');
    } catch (err) { setError(err as ApiFail); setBusy(false); }
  };

  if (checking) return <div className="grid min-h-screen place-items-center text-sm text-ink-500">Loading…</div>;
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-600 text-white shadow-card"><img src="/EdgeWeb Black.png" alt="Logo" className="mx-auto h-8 w-auto" /></span>
          <h1>Sign in to Finance Portal</h1>
          <p className="text-sm text-ink-500">Project cost &amp; profitability management</p>
        </div>
        <form onSubmit={submit} className="card card-pad space-y-4" noValidate>
          <ErrorBox error={error} />
          <Field label="Email" required><Input type="email" autoComplete="username" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Password" required><Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <Button type="submit" variant="primary" className="w-full" loading={busy} disabled={!email || !password}>Sign in</Button>
        </form>
      </div>
    </main>
  );
}
export default function LoginPage() { return <Suspense><LoginForm /></Suspense>; }
