'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound } from 'lucide-react';
import { api, ApiFail, setCsrf } from '@/ui/api';
import { SessionProvider, useSession } from '@/ui/session';
import { Button, ErrorBox, Field, Input, Notice, useToast } from '@/ui/kit';

function Form() {
  const router = useRouter();
  const { me, signOut } = useSession();
  const toast = useToast();
  const [cur, setCur] = useState(''); const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState<ApiFail | null>(null);
  const mismatch = pw2.length > 0 && pw !== pw2;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || mismatch) return;
    setBusy(true); setError(null);
    try {
      await api.post('/api/auth/change-password', { currentPassword: cur, newPassword: pw });
      toast.success('Password updated');
      const r = await api.get<{ csrfToken: string }>('/api/auth/me'); setCsrf(r.data.csrfToken);
      window.location.href = '/';
    } catch (err) { setError(err as ApiFail); setBusy(false); }
  };
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <form onSubmit={submit} className="card card-pad w-full max-w-sm space-y-4">
        <div className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-brand-600" /><h1>{me.user.mustChangePw ? 'Set a new password' : 'Change password'}</h1></div>
        {me.user.mustChangePw && <Notice tone="warn">You must choose a new password before continuing.</Notice>}
        <ErrorBox error={error} />
        <Field label="Current password" required><Input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
        <Field label="New password" required hint="At least 10 characters with upper, lower case, a number and a symbol."><Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        <Field label="Confirm new password" required error={mismatch ? 'Passwords do not match' : undefined}><Input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} invalid={mismatch} /></Field>
        <div className="flex gap-2">
          <Button type="submit" variant="primary" className="flex-1" loading={busy} disabled={!cur || !pw || mismatch}>Update password</Button>
          {!me.user.mustChangePw && <Button onClick={() => router.back()}>Cancel</Button>}
          {me.user.mustChangePw && <Button onClick={signOut}>Sign out</Button>}
        </div>
      </form>
    </main>
  );
}
export default function Page() { return <SessionProvider><Form /></SessionProvider>; }
