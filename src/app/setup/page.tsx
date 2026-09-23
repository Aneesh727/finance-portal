'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Landmark } from 'lucide-react';
import { api, ApiFail } from '@/ui/api';
import { Button, ErrorBox, Field, Input, Notice, Select, Check, useForm } from '@/ui/kit';

const SERVICES = ['Web Development', 'App Development', 'Software Development', 'UI/UX Design', 'Digital Marketing', 'SEO', 'Social Media Marketing', 'Branding', 'Graphic Design', 'Event Management', 'Consulting', 'Maintenance', 'Retainer', 'Other'];
const COSTS = ['Developer', 'Designer', 'QA', 'Project Manager', 'Marketing', 'SEO', 'Copywriter', 'Video', 'Photography', 'Hosting', 'Domain', 'Software', 'API', 'AI Services', 'Cloud', 'Third Party', 'Vendor', 'Freelancer', 'Travel', 'Event', 'Printing', 'Advertising', 'Miscellaneous'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function SetupPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [step, setStep] = useState(0);
  const f = useForm({ companyName: '', gstin: '', address: '', baseCurrency: 'INR', fyStartMonth: '4', defaultTaxRatePct: '18', marginTargetPct: '30', adminName: '', adminEmail: '', adminPassword: '', adminPassword2: '' });
  const [svc, setSvc] = useState<string[]>(SERVICES);
  const [cost, setCost] = useState<string[]>(COSTS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiFail | null>(null);

  useEffect(() => {
    api.get<{ needsSetup: boolean }>('/api/setup/status').then((r) => { if (!r.data.needsSetup) router.replace('/login'); else setReady(true); }).catch(() => setReady(true));
  }, [router]);

  const v = f.values;
  const validate = (s: number) => {
    const e: Record<string, string> = {};
    if (s === 0) {
      if (!v.companyName.trim()) e.companyName = 'Company name is required';
      if (v.gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(v.gstin.toUpperCase())) e.gstin = 'Enter a valid 15-character GSTIN or leave blank';
      const t = Number(v.defaultTaxRatePct); if (Number.isNaN(t) || t < 0 || t > 100) e.defaultTaxRatePct = 'Enter 0–100';
    }
    if (s === 1) {
      if (!v.adminName.trim()) e.adminName = 'Name is required';
      if (!/^\S+@\S+\.\S+$/.test(v.adminEmail)) e.adminEmail = 'Enter a valid email';
      if (v.adminPassword.length < 10) e.adminPassword = 'At least 10 characters';
      else if (!/[a-z]/.test(v.adminPassword) || !/[A-Z]/.test(v.adminPassword) || !/\d/.test(v.adminPassword) || !/[^A-Za-z0-9]/.test(v.adminPassword)) e.adminPassword = 'Include upper and lower case, a number and a symbol';
      if (v.adminPassword2 !== v.adminPassword) e.adminPassword2 = 'Passwords do not match';
    }
    f.setErrors(e);
    return Object.keys(e).length === 0;
  };
  const next = () => { if (validate(step)) setStep(step + 1); };
  const submit = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await api.post('/api/setup', {
        companyName: v.companyName, gstin: v.gstin ? v.gstin.toUpperCase() : undefined, address: v.address || undefined, baseCurrency: v.baseCurrency, fyStartMonth: Number(v.fyStartMonth),
        defaultTaxRatePct: Number(v.defaultTaxRatePct), marginTargetPct: Number(v.marginTargetPct), adminName: v.adminName, adminEmail: v.adminEmail, adminPassword: v.adminPassword,
        serviceCategories: svc, costCategories: cost,
      });
      window.location.href = '/';
    } catch (e) {
      setError(e as ApiFail); f.fail(e);
      if (e instanceof ApiFail && e.fields.adminPassword) setStep(1);
      setBusy(false);
    }
  };
  if (!ready) return <div className="grid min-h-screen place-items-center text-sm text-ink-500">Loading…</div>;
  const toggle = (list: string[], set: (l: string[]) => void, n: string) => set(list.includes(n) ? list.filter((x) => x !== n) : [...list, n]);
  const steps = ['Company', 'Administrator', 'Categories', 'Review'];
  return (
    <main className="mx-auto min-h-screen max-w-2xl px-4 py-10">
      <div className="mb-6 flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-600 text-white"><Landmark className="h-5 w-5" /></span><div><h1>Welcome — let’s set up your portal</h1><p className="text-sm text-ink-500">This takes about two minutes. You can change everything later in Settings.</p></div></div>
      <ol className="mb-5 flex gap-2 text-xs" aria-label="Setup progress">{steps.map((s, i) => <li key={s} className={`flex-1 rounded-full px-3 py-1.5 text-center font-medium ${i === step ? 'bg-brand-600 text-white' : i < step ? 'bg-brand-100 text-brand-700' : 'bg-ink-100 text-ink-500'}`}>{i + 1}. {s}</li>)}</ol>
      <div className="card card-pad space-y-4">
        {step === 0 && <>
          <Field label="Company name" required error={f.errors.companyName}><Input {...f.bind('companyName')} autoFocus /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="GSTIN" error={f.errors.gstin} hint="Optional. Used for CGST/SGST vs IGST on invoices."><Input {...f.bind('gstin')} maxLength={15} className="uppercase" /></Field>
            <Field label="Default GST rate (%)" error={f.errors.defaultTaxRatePct}><Input {...f.bind('defaultTaxRatePct')} inputMode="decimal" /></Field>
          </div>
          <Field label="Address"><Input {...f.bind('address')} /></Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Base currency"><Select {...f.bind('baseCurrency')}>{['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD'].map((c) => <option key={c}>{c}</option>)}</Select></Field>
            <Field label="Financial year starts"><Select {...f.bind('fyStartMonth')}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</Select></Field>
            <Field label="Target margin (%)"><Input {...f.bind('marginTargetPct')} inputMode="decimal" /></Field>
          </div>
        </>}
        {step === 1 && <>
          <Notice>This account becomes the Super Admin. Choose a strong password — there is no default account.</Notice>
          <Field label="Your name" required error={f.errors.adminName}><Input {...f.bind('adminName')} autoFocus autoComplete="name" /></Field>
          <Field label="Email" required error={f.errors.adminEmail}><Input {...f.bind('adminEmail')} type="email" autoComplete="username" /></Field>
          <Field label="Password" required error={f.errors.adminPassword} hint="At least 10 characters with upper, lower case, a number and a symbol."><Input {...f.bind('adminPassword')} type="password" autoComplete="new-password" /></Field>
          <Field label="Confirm password" required error={f.errors.adminPassword2}><Input {...f.bind('adminPassword2')} type="password" autoComplete="new-password" /></Field>
        </>}
        {step === 2 && <>
          <div><h3 className="mb-2">Service categories</h3><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{SERVICES.map((s) => <Check key={s} label={s} checked={svc.includes(s)} onChange={() => toggle(svc, setSvc, s)} />)}</div></div>
          <div><h3 className="mb-2">Cost categories</h3><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{COSTS.map((s) => <Check key={s} label={s} checked={cost.includes(s)} onChange={() => toggle(cost, setCost, s)} />)}</div></div>
        </>}
        {step === 3 && <>
          <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
            <dt className="text-ink-500">Company</dt><dd>{v.companyName}</dd>
            <dt className="text-ink-500">GSTIN</dt><dd>{v.gstin || '—'}</dd>
            <dt className="text-ink-500">Currency / FY</dt><dd>{v.baseCurrency} · starts {MONTHS[Number(v.fyStartMonth) - 1]}</dd>
            <dt className="text-ink-500">Default GST</dt><dd>{v.defaultTaxRatePct}%</dd>
            <dt className="text-ink-500">Administrator</dt><dd>{v.adminName} ({v.adminEmail})</dd>
            <dt className="text-ink-500">Categories</dt><dd>{svc.length} service · {cost.length} cost</dd>
          </dl>
          <ErrorBox error={error} />
        </>}
        <div className="flex justify-between pt-2">
          <Button onClick={() => setStep(step - 1)} disabled={step === 0 || busy}>Back</Button>
          {step < 3 ? <Button variant="primary" onClick={next}>Continue</Button> : <Button variant="primary" loading={busy} onClick={submit}>Finish setup</Button>}
        </div>
      </div>
    </main>
  );
}
