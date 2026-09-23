/**
 * Seed script.
 *
 *   npm run db:seed            reference data only (roles, permissions, categories, GST slabs, payment terms). Safe on every deploy.
 *   npm run db:seed:demo       + a realistic demo company: users, clients, vendors, resources, 19 projects, invoices, payments,
 *                                expenses, retainers, recurring rules, employee allocations and deals. Every demo row is flagged is_demo
 *                                and can be removed with `npm run db:remove-demo`.
 *
 * Optional env for a non-interactive production bootstrap (instead of the web setup wizard):
 *   SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD, SEED_ADMIN_NAME, SEED_COMPANY_NAME
 *
 * All transactional demo data is created through the SAME service layer the API uses, so it obeys every business rule
 * (budget guard, GST split, allocation limits ...) and every figure in the demo is internally consistent.
 */
import { and, eq, sql } from 'drizzle-orm';
import { db, closeDb } from '@/lib/db';
import { ensureBaseData, findRoleId } from '@/lib/base-data';
import {
  categories, clients, company, deals, employeeAllocations, expenses, invoices, payments, projectCosts, projects, recurringRules, resources, resourceRateHistory, retainers, users, vendors,
} from '@/db/schema';
import { hashPassword, validatePasswordStrength } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { addMonths, monthStart, todayStr, addDays } from '@/lib/dates';
import { deriveRates } from '@/lib/services/resources';
import { createProject, changeStatus } from '@/lib/services/projects';
import { createCost } from '@/lib/services/costs';
import { createInvoice, recordPayment } from '@/lib/services/billing';
import { createExpense, setAllocations } from '@/lib/services/expenses';
import { createRule, generateForRule } from '@/lib/services/recurring-expenses';
import { setEmployeeAllocation } from '@/lib/services/employee-alloc';
import { createRetainer, generateRetainerInvoices, setHours } from '@/lib/services/retainers';
import { createDeal, convertDeal, markLost } from '@/lib/services/deals';
import { assignResource, assignmentBody } from '@/lib/services/project-parts';
import { evaluateProjectAlerts, runNotificationScan } from '@/lib/services/alerts';
import { costBody, expenseBody, invoiceBody, paymentBody, projectBody, recurringBody, retainerCreate, dealBody } from '@/lib/validators';
import { ctxForUser, systemUser, SYSTEM_ACTOR } from './_ctx';
import type { RoleKey } from '@/lib/permissions';

const DEMO = process.argv.includes('--demo');
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD || 'Demo@Portal2026!';

const log = (m: string) => console.log(m);
const R = (n: number) => n.toFixed(2);

async function ensureAdmin() {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const pw = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !pw) return;
  const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(users)) as { n: number }[];
  if (n > 0) return log('Users already exist - SEED_ADMIN_* ignored.');
  const weak = validatePasswordStrength(pw);
  if (weak) throw new Error(`SEED_ADMIN_PASSWORD rejected: ${weak}`);
  await db.insert(company).values({ id: 'singleton', name: process.env.SEED_COMPANY_NAME || 'My Company', baseCurrency: 'INR', fyStartMonth: 4, setupComplete: true }).onConflictDoNothing();
  await db.insert(users).values({ email, name: process.env.SEED_ADMIN_NAME || 'Administrator', passwordHash: await hashPassword(pw), roleId: await findRoleId(db, 'SUPER_ADMIN'), mustChangePw: false });
  log(`Created Super Admin ${email}`);
}

async function main() {
  await ensureBaseData(db);
  log('Reference data ready (roles, permissions, categories, GST slabs, payment terms).');
  await ensureAdmin();
  if (DEMO) await seedDemo();
  await closeDb();
}

// ───────────────────────────────────────────────────────────────────────────
async function flagDemo(started: Date) {
  const since = started.toISOString();
  for (const table of ['projects', 'project_costs', 'invoices', 'payments', 'recurring_rules', 'expenses', 'employee_allocations', 'retainers', 'deals', 'clients', 'vendors', 'resources']) {
    await db.execute(sql`UPDATE ${sql.identifier(table)} SET is_demo = true WHERE created_at >= ${since}::timestamptz`);
  }
}

async function seedDemo() {
  const [existing] = await db.select({ n: sql<number>`count(*)::int` }).from(projects).where(eq(projects.isDemo, true));
  if (existing.n > 0) { log('Demo data already present (run `npm run db:remove-demo` first to reseed).'); return; }
  const started = new Date();
  try {
    await seedDemoInner(started);
  } catch (e) {
    await flagDemo(started); // so a half-finished seed can be cleaned with `npm run db:remove-demo`
    console.error('\nThe demo seed stopped part-way. Run `npm run db:remove-demo` before trying again.');
    throw e;
  }
}

async function seedDemoInner(started: Date) {
  const today = todayStr();
  const thisMonth = monthStart(today);
  const mo = (offset: number, day = 1) => { const m = addMonths(thisMonth, offset); return `${m.slice(0, 8)}${String(day).padStart(2, '0')}`; };
  const past = (d: string) => (d > today ? today : d);

  // company (only when no real one exists)
  const [co] = await db.select().from(company).limit(1);
  if (!co) await db.insert(company).values({ id: 'singleton', name: 'Demo Agency Pvt Ltd', gstin: '27AAPFU0939F1ZV', stateCode: '27', address: 'Andheri East, Mumbai 400069', baseCurrency: 'INR', fyStartMonth: 4, setupComplete: true });
  else if (co.name === 'My Company' && !co.gstin) await db.update(company).set({ name: 'Demo Agency Pvt Ltd', gstin: '27AAPFU0939F1ZV', stateCode: '27', address: 'Andheri East, Mumbai 400069' }).where(eq(company.id, 'singleton'));

  // users
  const roleIds: Record<string, string> = {};
  for (const k of ['SUPER_ADMIN', 'ADMIN', 'FINANCE', 'PROJECT_MANAGER', 'TEAM_MEMBER', 'VIEWER'] as RoleKey[]) roleIds[k] = await findRoleId(db, k);
  const hash = await hashPassword(DEMO_PASSWORD);
  const mkUser = async (name: string, email: string, role: RoleKey) => {
    const [u] = await db.insert(users).values({ name, email, passwordHash: hash, roleId: roleIds[role], mustChangePw: false, isDemo: true }).onConflictDoNothing().returning();
    if (u) return u;
    const [e] = await db.select().from(users).where(eq(users.email, email)); return e;
  };
  const admin = await mkUser('Demo Admin', 'admin@demo.portal', 'SUPER_ADMIN');
  const fin = await mkUser('Farah Finance', 'finance@demo.portal', 'FINANCE');
  const pm1 = await mkUser('Pranav Manager', 'pm@demo.portal', 'PROJECT_MANAGER');
  const pm2 = await mkUser('Priya Manager', 'pm2@demo.portal', 'PROJECT_MANAGER');
  const tm = await mkUser('Tarun Member', 'member@demo.portal', 'TEAM_MEMBER');
  await mkUser('Vikram Viewer', 'viewer@demo.portal', 'VIEWER');
  await mkUser('Ada Admin', 'ops@demo.portal', 'ADMIN');
  const ctx = await ctxForUser(admin.id);
  const finCtx = await ctxForUser(fin.id);
  const pmCtx = await ctxForUser(pm1.id);
  const tx = db; // services accept any Executor; use the pool directly - each call is its own transaction where it matters
  const run = <T>(f: (t: typeof db) => Promise<T>) => db.transaction((t) => f(t as never));

  // categories
  const cat = async (kind: 'SERVICE' | 'COST' | 'EXPENSE', name: string) => {
    const [c] = await db.select().from(categories).where(and(eq(categories.kind, kind), eq(categories.name, name)));
    if (!c) throw new Error(`category ${kind}/${name} missing`);
    return c.id;
  };

  // clients (mix of states => CGST/SGST vs IGST)
  const clientDefs: [string, string, string, string, string][] = [
    ['Acme Traders Pvt Ltd', 'Retail', '27', 'Riya Shah', '27AAPFU0939F1ZV'], ['BlueOrbit Technologies', 'IT Services', '29', 'Karthik Rao', '29AABCB1234C1Z5'],
    ['Cedar & Pine Furnishings', 'Home Decor', '27', 'Meera Joshi', '27AAACC5678D1Z2'], ['Delta Logistics LLP', 'Logistics', '24', 'Hitesh Patel', '24AAJFD4321E1ZB'],
    ['Evergreen Organics', 'FMCG', '07', 'Anita Verma', '07AAECE9876F1Z9'], ['FinEdge Capital', 'Financial Services', '27', 'Sameer Khan', '27AAGCF2468G1Z1'],
    ['Globe Trotters Travel', 'Travel', '33', 'Lakshmi Iyer', '33AAHCG1357H1Z8'], ['Helix Healthcare', 'Healthcare', '27', 'Dr. Nisha Rao', '27AAICH8642J1Z3'],
    ['Indus Education Trust', 'Education', '08', 'Ravi Meena', ''], ['Juno Fashion House', 'Fashion', '27', 'Tanya Kapoor', '27AAKCJ7531K1Z6'],
    ['Kite Studios', 'Media', '29', 'Arjun Nair', '29AALCK9513L1Z4'], ['Lumen Solar Pvt Ltd', 'Energy', '24', 'Bhavin Shah', '24AAMCL3579M1Z7'],
  ];
  const C: string[] = [];
  for (const [companyName, industry, stateCode, contactPerson, gstin] of clientDefs) {
    const [c] = await db.insert(clients).values({ companyName, industry, stateCode, contactPerson, gstin: gstin || null, email: `${contactPerson.split(' ')[0].toLowerCase()}@${companyName.split(' ')[0].toLowerCase()}.example`, country: 'India', currency: 'INR', isDemo: true } as never).returning();
    C.push(c.id);
  }

  // vendors
  const V: string[] = [];
  for (const [name, category] of [['CloudNine Hosting', 'Hosting'], ['PixelForge Studio', 'Design'], ['AdReach Media', 'Advertising'], ['DevBridge Consulting', 'Development'], ['PrintWorks India', 'Printing']]) {
    const [v] = await db.insert(vendors).values({ name, category, email: `accounts@${name.split(' ')[0].toLowerCase()}.example`, isDemo: true } as never).returning();
    V.push(v.id);
  }

  // resources
  const settings = await getSettings();
  const RES: Record<string, string> = {};
  const mkRes = async (key: string, name: string, role: string, type: 'EMPLOYEE' | 'FREELANCER' | 'CONTRACTOR' | 'AGENCY', v: { hourlyCost?: string; dailyCost?: string; monthlyCost?: string; billingRate?: string }, startDate?: string) => {
    const base = { hourlyCost: '0', dailyCost: '0', monthlyCost: '0', billingRate: '0', ...v };
    const rates = deriveRates({ ...base, type }, settings);
    const [r] = await db.insert(resources).values({ name, role, type, ...base, ...rates, department: type === 'EMPLOYEE' ? 'Delivery' : null, startDate: startDate ?? null, status: 'ACTIVE', isDemo: true } as never).returning();
    await db.insert(resourceRateHistory).values({ resourceId: r.id, effectiveOn: today, hourlyCost: r.hourlyCost, dailyCost: r.dailyCost, monthlyCost: r.monthlyCost, billingRate: r.billingRate });
    RES[key] = r.id;
  };
  await mkRes('dev1', 'Aarav Mehta', 'Senior Developer', 'EMPLOYEE', { monthlyCost: '120000', billingRate: '1800' }, mo(-9, 1));
  await mkRes('dev2', 'Bhavna Rao', 'Developer', 'EMPLOYEE', { monthlyCost: '80000', billingRate: '1300' }, mo(-9, 1));
  await mkRes('des1', 'Chirag Desai', 'UI/UX Designer', 'EMPLOYEE', { monthlyCost: '75000', billingRate: '1200' }, mo(-9, 1));
  await mkRes('pm', 'Divya Menon', 'Project Manager', 'EMPLOYEE', { monthlyCost: '95000', billingRate: '1500' }, mo(-9, 1));
  await mkRes('mkt', 'Esha Kulkarni', 'Marketing Lead', 'EMPLOYEE', { monthlyCost: '70000', billingRate: '1100' }, mo(-9, 1));
  await mkRes('qa', 'Farhan Ali', 'QA Engineer', 'EMPLOYEE', { monthlyCost: '55000', billingRate: '900' }, mo(-9, 1));
  await mkRes('fl1', 'Gaurav Sinha', 'Freelance Developer', 'FREELANCER', { hourlyCost: '900', billingRate: '1500' });
  await mkRes('fl2', 'Heena Shah', 'Freelance Copywriter', 'FREELANCER', { hourlyCost: '500', billingRate: '900' });
  await mkRes('fl3', 'Imran Qureshi', 'Freelance Video Editor', 'FREELANCER', { dailyCost: '4500', billingRate: '1000' });
  await mkRes('con1', 'Jaya Nambiar', 'SEO Consultant', 'CONTRACTOR', { hourlyCost: '1200', billingRate: '2000' });
  await mkRes('ag1', 'SocialSpark Agency', 'Social Media Agency', 'AGENCY', { hourlyCost: '1500', billingRate: '2200' });

  // ── projects ──────────────────────────────────────────────────────────────
  const svc = { web: await cat('SERVICE', 'Web Development'), app: await cat('SERVICE', 'App Development'), ux: await cat('SERVICE', 'UI/UX Design'), dm: await cat('SERVICE', 'Digital Marketing'), seo: await cat('SERVICE', 'SEO'), brand: await cat('SERVICE', 'Branding'), event: await cat('SERVICE', 'Event Management'), consult: await cat('SERVICE', 'Consulting'), sw: await cat('SERVICE', 'Software Development'), maint: await cat('SERVICE', 'Maintenance') };
  const cc = { dev: await cat('COST', 'Developer'), des: await cat('COST', 'Designer'), qa: await cat('COST', 'QA'), pm: await cat('COST', 'Project Manager'), mkt: await cat('COST', 'Marketing'), host: await cat('COST', 'Hosting'), soft: await cat('COST', 'Software'), fl: await cat('COST', 'Freelancer'), ven: await cat('COST', 'Vendor'), ad: await cat('COST', 'Advertising'), evt: await cat('COST', 'Event'), print: await cat('COST', 'Printing'), third: await cat('COST', 'Third Party') };

  interface PDef {
    key: string; name: string; c: number; s: keyof typeof svc; type: 'ONE_TIME' | 'MILESTONE' | 'HOURLY' | 'FIXED_RECURRING'; status: string; price: number; budget: number; start: number; end: number; mgr: string; tax?: number;
    est?: [keyof typeof cc, number][]; costs?: [keyof typeof cc, number, number, string?][]; invoices?: { pct: number; month: number; paid: number; tds?: number; overdue?: boolean }[]; milestones?: { name: string; price: number; cost: number }[]; members?: string[]; over?: boolean;
  }
  const mgr: Record<string, string> = { pm1: pm1.id, pm2: pm2.id };
  const defs: PDef[] = [
    { key: 'p1', name: 'Acme E-commerce Store', c: 0, s: 'web', type: 'ONE_TIME', status: 'ACTIVE', price: 500000, budget: 300000, start: -3, end: 2, mgr: 'pm1', est: [['dev', 120000], ['des', 50000], ['qa', 30000], ['host', 10000], ['third', 20000]], costs: [['dev', 140000, -3], ['des', 45000, -2], ['qa', 30000, -1], ['host', 10000, -2], ['third', 25000, -1]], invoices: [{ pct: 30, month: -3, paid: 100 }, { pct: 40, month: -1, paid: 50 }, { pct: 30, month: 1, paid: 0 }], members: ['pm1', 'tm'] },
    { key: 'p2', name: 'BlueOrbit Mobile App', c: 1, s: 'app', type: 'MILESTONE', status: 'ACTIVE', price: 900000, budget: 600000, start: -4, end: 3, mgr: 'pm2', tax: 18, milestones: [{ name: 'Discovery & wireframes', price: 150000, cost: 80000 }, { name: 'Design system', price: 200000, cost: 110000 }, { name: 'MVP build', price: 350000, cost: 240000 }, { name: 'Launch & hardening', price: 200000, cost: 90000 }], costs: [['dev', 220000, -3], ['des', 105000, -2], ['dev', 180000, -1], ['qa', 40000, -1]], invoices: [{ pct: 17, month: -4, paid: 100, tds: 10 }, { pct: 22, month: -2, paid: 100, tds: 10 }, { pct: 39, month: -1, paid: 0, overdue: true }] },
    { key: 'p3', name: 'Cedar & Pine Rebrand', c: 2, s: 'brand', type: 'ONE_TIME', status: 'COMPLETED', price: 320000, budget: 200000, start: -6, end: -2, mgr: 'pm1', costs: [['des', 90000, -5], ['fl', 40000, -4], ['print', 35000, -3, 'PrintWorks India']], invoices: [{ pct: 50, month: -6, paid: 100 }, { pct: 50, month: -3, paid: 100 }] },
    { key: 'p4', name: 'Delta Logistics Tracking Portal', c: 3, s: 'sw', type: 'ONE_TIME', status: 'ACTIVE', price: 1200000, budget: 700000, start: -5, end: 1, mgr: 'pm2', costs: [['dev', 300000, -4], ['dev', 280000, -3], ['qa', 60000, -2], ['host', 25000, -2], ['dev', 200000, -1], ['third', 60000, -1]], invoices: [{ pct: 25, month: -5, paid: 100 }, { pct: 25, month: -3, paid: 100 }, { pct: 25, month: -1, paid: 60 }], over: true },
    { key: 'p5', name: 'Evergreen Launch Campaign', c: 4, s: 'dm', type: 'ONE_TIME', status: 'ACTIVE', price: 450000, budget: 280000, start: -2, end: 1, mgr: 'pm1', costs: [['ad', 120000, -2, 'AdReach Media'], ['mkt', 45000, -1], ['fl', 30000, -1]], invoices: [{ pct: 50, month: -2, paid: 100 }, { pct: 50, month: 0, paid: 0 }] },
    { key: 'p6', name: 'FinEdge Website Revamp', c: 5, s: 'web', type: 'ONE_TIME', status: 'ON_HOLD', price: 380000, budget: 240000, start: -4, end: 0, mgr: 'pm2', costs: [['dev', 70000, -4], ['des', 40000, -3]], invoices: [{ pct: 40, month: -4, paid: 100 }] },
    { key: 'p7', name: 'Globe Trotters Booking Engine', c: 6, s: 'sw', type: 'HOURLY', status: 'ACTIVE', price: 600000, budget: 420000, start: -3, end: 2, mgr: 'pm1', costs: [['dev', 150000, -2], ['fl', 90000, -1], ['dev', 110000, 0]], invoices: [{ pct: 25, month: -3, paid: 100 }, { pct: 25, month: -1, paid: 100 }] },
    { key: 'p8', name: 'Helix Patient App', c: 7, s: 'app', type: 'MILESTONE', status: 'ONBOARDING', price: 750000, budget: 500000, start: 0, end: 5, mgr: 'pm2', est: [['dev', 260000], ['des', 90000], ['qa', 50000]], milestones: [{ name: 'Requirements', price: 100000, cost: 50000 }, { name: 'Build', price: 450000, cost: 300000 }, { name: 'Release', price: 200000, cost: 90000 }], invoices: [{ pct: 20, month: 0, paid: 100 }] },
    { key: 'p9', name: 'Indus Learning Portal', c: 8, s: 'web', type: 'ONE_TIME', status: 'COMPLETED', price: 260000, budget: 180000, start: -8, end: -4, mgr: 'pm1', costs: [['dev', 110000, -7], ['des', 30000, -6], ['host', 8000, -5]], invoices: [{ pct: 100, month: -5, paid: 100 }] },
    { key: 'p10', name: 'Juno Fashion Lookbook Shoot', c: 9, s: 'brand', type: 'ONE_TIME', status: 'ACTIVE', price: 280000, budget: 190000, start: -1, end: 1, mgr: 'pm2', costs: [['fl', 65000, -1], ['evt', 55000, 0], ['print', 22000, 0, 'PrintWorks India']], invoices: [{ pct: 50, month: -1, paid: 100 }, { pct: 50, month: 1, paid: 0 }] },
    { key: 'p11', name: 'Kite Studios Explainer Videos', c: 10, s: 'brand', type: 'ONE_TIME', status: 'COMPLETED', price: 210000, budget: 120000, start: -5, end: -3, mgr: 'pm1', costs: [['fl', 110000, -4], ['third', 30000, -4], ['des', 60000, -3]], invoices: [{ pct: 100, month: -3, paid: 100, tds: 10 }] },
    { key: 'p12', name: 'Lumen Solar Lead-Gen', c: 11, s: 'dm', type: 'FIXED_RECURRING', status: 'ACTIVE', price: 0, budget: 500000, start: -4, end: 8, mgr: 'pm2', costs: [['ad', 90000, -3, 'AdReach Media'], ['mkt', 40000, -2], ['ad', 95000, -1, 'AdReach Media']], invoices: [] },
    { key: 'p13', name: 'Acme Inventory Sync (Maintenance)', c: 0, s: 'maint', type: 'ONE_TIME', status: 'ACTIVE', price: 180000, budget: 90000, start: -2, end: 4, mgr: 'pm1', costs: [['dev', 50000, -1], ['host', 12000, 0]], invoices: [{ pct: 50, month: -2, paid: 100 }] },
    { key: 'p14', name: 'BlueOrbit Cloud Migration', c: 1, s: 'consult', type: 'ONE_TIME', status: 'ACTIVE', price: 640000, budget: 400000, start: -2, end: 3, mgr: 'pm2', costs: [['dev', 190000, -1], ['third', 70000, 0], ['soft', 20000, 0]], invoices: [{ pct: 40, month: -2, paid: 100, tds: 10 }, { pct: 30, month: 0, paid: 0 }] },
    { key: 'p15', name: 'Cedar & Pine Marketplace Listing', c: 2, s: 'dm', type: 'ONE_TIME', status: 'NEGOTIATION', price: 150000, budget: 100000, start: 1, end: 3, mgr: 'pm1', est: [['mkt', 40000], ['fl', 20000]], invoices: [] },
    { key: 'p16', name: 'Delta Fleet Dashboard', c: 3, s: 'sw', type: 'ONE_TIME', status: 'PROPOSAL', price: 480000, budget: 320000, start: 1, end: 5, mgr: 'pm2', est: [['dev', 200000], ['des', 50000]], invoices: [] },
    { key: 'p17', name: 'FinEdge Loan Calculator', c: 5, s: 'web', type: 'ONE_TIME', status: 'CANCELLED', price: 120000, budget: 80000, start: -3, end: -1, mgr: 'pm1', costs: [['dev', 22000, -3]], invoices: [{ pct: 30, month: -3, paid: 100 }] },
    { key: 'p18', name: 'Helix Brand Guidelines', c: 7, s: 'brand', type: 'ONE_TIME', status: 'COMPLETED', price: 95000, budget: 40000, start: -3, end: -2, mgr: 'pm2', costs: [['des', 62000, -3]], invoices: [{ pct: 100, month: -2, paid: 100 }], over: true },
  ];

  const P: Record<string, string> = {};
  const emptyProject = { description: null, salesOwnerId: null, contractDate: null, priority: 'MEDIUM', currency: undefined, discount: '0', setupFee: '0', monthlyFee: '0', durationMonths: 0, paymentTerms: 'Net 15', notes: null };
  for (const d of defs) {
    const recurring = d.type === 'FIXED_RECURRING';
    const input = projectBody.parse({
      ...emptyProject, name: d.name, clientId: C[d.c], serviceId: svc[d.s], type: d.type, status: ['CANCELLED', 'COMPLETED', 'ON_HOLD'].includes(d.status) ? 'ACTIVE' : d.status,
      sellingPrice: recurring ? '0' : R(d.price), monthlyFee: recurring ? '100000' : '0', durationMonths: recurring ? 12 : 0, budget: R(d.budget), taxMode: 'EXCLUSIVE', taxRatePct: d.tax ?? 18,
      startDate: mo(d.start, 3), endDate: mo(d.end, 28), managerId: mgr[d.mgr], memberIds: (d.members ?? []).map((m) => (m === 'tm' ? tm.id : mgr[m])),
      milestones: d.milestones?.map((m, i) => ({ name: m.name, price: R(m.price), cost: R(m.cost), status: i === 0 ? 'COMPLETED' : 'NOT_STARTED', dueDate: mo(d.start + i + 1, 15) })),
      estimatedCosts: d.est?.map(([k, a]) => ({ categoryId: cc[k], name: `Estimated ${k}`, amount: R(a) })),
    });
    const res = await run((t) => createProject(t, ctx, input));
    P[d.key] = res.project.id;
    // set the final status *before* costs/invoices where the lifecycle allows the activity
  }

  // costs
  const vendorByName = Object.fromEntries((await db.select().from(vendors).where(eq(vendors.isDemo, true))).map((v) => [v.name, v.id]));
  for (const d of defs) {
    for (const [k, amount, m, vend] of d.costs ?? []) {
      const body = costBody.parse({ projectId: P[d.key], name: `${k[0].toUpperCase()}${k.slice(1)} - ${mo(m).slice(0, 7)}`, categoryId: cc[k], amount: R(amount), date: past(mo(m, 12)), vendorId: vend ? vendorByName[vend] : null, overrideBudget: true, overrideReason: 'Demo data: intentional over-run', status: 'PAID' });
      await run((t) => createCost(t, ctx, body));
    }
  }
  // a committed cost and a pending-approval cost (requested by a PM, waiting for finance)
  await run((t) => createCost(t, ctx, costBody.parse({ projectId: P.p14, name: 'Committed: security audit', categoryId: cc.third, amount: '60000', kind: 'COMMITTED', date: mo(0, 25) })));
  await run((t) => createCost(t, pmCtx, costBody.parse({ projectId: P.p4, name: 'Extra server capacity', categoryId: cc.host, amount: '85000', date: today })));
  await run((t) => createCost(t, pmCtx, costBody.parse({ projectId: P.p2, name: 'Freelance QA burst', categoryId: cc.fl, amount: '150000', date: today })));

  // resource assignments (hourly/freelancer cost model)
  for (const [key, res, planned, actual] of [['p7', 'fl1', 200, 140], ['p10', 'fl3', 40, 22], ['p5', 'fl2', 120, 60], ['p12', 'ag1', 150, 95]] as const) {
    await run((t) => assignResource(t, ctx, P[key], assignmentBody.parse({ resourceId: RES[res], plannedHours: planned, actualHours: actual, overrideBudget: true, overrideReason: 'Demo data' })).catch(() => null));
  }

  // invoices + payments
  for (const d of defs) {
    for (const [i, inv] of (d.invoices ?? []).entries()) {
      const subtotal = Math.round((d.price * inv.pct) / 100);
      if (subtotal <= 0) continue;
      const issue = past(mo(inv.month, 5));
      const due = inv.overdue ? addDays(today, -25) : addDays(issue, 30);
      const body = invoiceBody.parse({ projectId: P[d.key], type: i === 0 ? 'ADVANCE' : 'MILESTONE', status: issue > today ? 'SCHEDULED' : 'ISSUED', issueDate: issue > today ? null : issue, dueDate: due < issue ? issue : due, subtotal: R(subtotal), description: `${d.name} - invoice ${i + 1}` });
      const created = await run((t) => createInvoice(t, SYSTEM_ACTOR_FOR(fin.id), { ...body, status: body.status } as never, { skipOverInvoiceCheck: true }));
      if (created.status === 'ISSUED' && inv.paid > 0) {
        const gross = Number(created.total);
        const settle = Math.round((gross * inv.paid) / 100);
        const tds = inv.tds ? Math.round((subtotal * inv.tds) / 100) : 0;
        const cash = Math.max(1, settle - tds);
        await run((t) => recordPayment(t, SYSTEM_ACTOR_FOR(fin.id), paymentBody.parse({ invoiceId: created.id, amount: R(cash), tdsAmount: R(tds), receivedDate: past(addDays(issue, 12)), method: i % 2 ? 'UPI' : 'BANK_TRANSFER', reference: `UTR${Math.floor(1e9 + Math.random() * 9e9)}` })));
      }
    }
  }

  // lifecycle end-states
  for (const d of defs) {
    if (['CANCELLED', 'COMPLETED', 'ON_HOLD'].includes(d.status)) await run((t) => changeStatus(t, ctx, P[d.key], d.status as never, d.status === 'CANCELLED' ? 'Client withdrew before build' : null, { bypassApproval: true }));
  }

  // retainers
  const mkRet = async (name: string, c: number, s: keyof typeof svc, fee: string, start: number, end: number, hours: number, rate: string, managerId: string) => {
    const r = await run((t) => createRetainer(t, ctx, retainerCreate.parse({ name, clientId: C[c], serviceId: svc[s], monthlyFee: fee, startDate: mo(start, 1), endDate: addDays(mo(end + 1, 1), -1), includedHours: hours, overageRate: rate, accountManagerId: managerId, taxMode: 'EXCLUSIVE', taxRatePct: 18, budget: '0' })));
    await run((t) => generateRetainerInvoices(t, ctx, r.retainer.id));
    return r;
  };
  const ret1 = await mkRet('Acme SEO Retainer', 0, 'seo', '60000', -5, 6, 30, '2500', pm1.id);
  const ret2 = await mkRet('FinEdge Social Media Retainer', 5, 'dm', '90000', -3, 8, 40, '2000', pm2.id);
  const ret3 = await mkRet('Juno Site Care Plan', 9, 'maint', '25000', -7, -1, 10, '1800', pm1.id); // expired
  for (const [rid, m, h] of [[ret1.retainer.id, -2, 38], [ret1.retainer.id, -1, 27], [ret2.retainer.id, -1, 52], [ret2.retainer.id, -2, 35]] as const) await run((t) => setHours(t, ctx, rid, mo(m, 1), h));
  void ret3;
  // pay most retainer invoices
  const retInv = await db.select().from(invoices).where(and(sql`${invoices.periodStart} is not null`, eq(invoices.status, 'ISSUED')));
  for (const [i, inv] of retInv.entries()) {
    if (i % 4 === 3) continue; // leave some unpaid → receivables / overdue
    await run((t) => recordPayment(t, SYSTEM_ACTOR_FOR(fin.id), paymentBody.parse({ invoiceId: inv.id, amount: inv.total, receivedDate: past(addDays(inv.issueDate ?? today, 8)), method: 'BANK_TRANSFER' }))).catch(() => null);
  }
  // some project retainer costs
  for (const [rid, m, a] of [[ret1.project.id, -1, 21000], [ret1.project.id, -2, 19000], [ret2.project.id, -1, 46000], [ret2.project.id, -2, 41000]] as const) {
    await run((t) => createCost(t, ctx, costBody.parse({ projectId: rid, name: `Delivery ${mo(m).slice(0, 7)}`, categoryId: cc.mkt, amount: R(a), date: mo(m, 20), overrideBudget: true, overrideReason: 'Demo' })));
  }

  // company expenses (+ allocations) over the last 6 months
  const ec = { office: await cat('EXPENSE', 'Office'), software: await cat('EXPENSE', 'Software'), subs: await cat('EXPENSE', 'Subscriptions'), mkt: await cat('EXPENSE', 'Marketing'), travel: await cat('EXPENSE', 'Travel'), equip: await cat('EXPENSE', 'Equipment'), cloud: await cat('EXPENSE', 'Cloud'), other: await cat('EXPENSE', 'Other') };
  const mkExp = (o: Record<string, unknown>) => run((t) => createExpense(t, ctx, expenseBody.parse({ paymentMethod: 'BANK_TRANSFER', scope: 'COMPANY', taxAmount: '0', ...o }) as never));
  for (let m = -5; m <= 0; m++) {
    await mkExp({ date: past(mo(m, 1)), categoryId: ec.office, description: `Office rent ${mo(m).slice(0, 7)}`, amount: '85000', taxAmount: '15300' });
    await mkExp({ date: past(mo(m, 7)), categoryId: ec.cloud, description: `Cloud infrastructure ${mo(m).slice(0, 7)}`, amount: R(28000 + m * 900 + 5000), vendorId: V[0] });
  }
  const bigExp = await mkExp({ date: past(mo(-2, 10)), categoryId: ec.equip, description: 'Developer laptops (4)', amount: '360000', taxAmount: '64800', vendorId: V[3], overrideBudget: true, overrideReason: 'Demo data' });
  await mkExp({ date: past(mo(-1, 9)), categoryId: ec.travel, description: 'Client visit - Bengaluru', amount: '32000' });
  await mkExp({ date: past(mo(-1, 20)), categoryId: ec.mkt, description: 'Agency brand campaign', amount: '120000', vendorId: V[2] });
  const shared = await mkExp({ date: past(mo(-1, 3)), categoryId: ec.software, description: 'Design tool licences (shared)', amount: '60000', taxAmount: '10800' });
  await run((t) => setAllocations(t, ctx, (shared as { expense?: { id: string } }).expense?.id ?? (shared as unknown as { id: string }).id, [
    { targetType: 'PROJECT', projectId: P.p1, method: 'PERCENT', value: 30 }, { targetType: 'PROJECT', projectId: P.p2, method: 'PERCENT', value: 30 }, { targetType: 'PROJECT', projectId: P.p10, method: 'PERCENT', value: 20 }] as never));
  void bigExp;
  await mkExp({ date: past(mo(0, 2)), categoryId: ec.other, description: 'Project-specific: stock photography', amount: '9500', scope: 'PROJECT', projectId: P.p10 });

  // recurring rules
  for (const [name, catId, amt, tax, freq, start, vendor] of [
    ['Google Workspace', ec.subs, '18000', '3240', 'MONTHLY', -6, undefined], ['GitHub Team', ec.subs, '9000', '1620', 'MONTHLY', -6, undefined],
    ['Cyber-insurance premium', ec.other, '48000', '8640', 'QUARTERLY', -6, undefined], ['Domain & SSL renewals', ec.cloud, '36000', '6480', 'YEARLY', -8, V[0]],
  ] as [string, string, string, string, string, number, string | undefined][]) {
    const rule = await run((t) => createRule(t, ctx, recurringBody.parse({ name, categoryId: catId, amount: amt, taxAmount: tax, frequency: freq, startDate: mo(start, 1), vendorId: vendor ?? null })));
    await run((t) => generateForRule(t, ctx, rule.id));
  }

  // employee cost allocation for the last three months
  const emp = (await db.select().from(resources).where(and(eq(resources.isDemo, true), eq(resources.type, 'EMPLOYEE'))));
  const plan: Record<string, [string, number][]> = { dev1: [['p1', 40], ['p4', 40], ['p14', 20]], dev2: [['p2', 60], ['p4', 30]], des1: [['p1', 25], ['p10', 35], ['p2', 30]], pm: [['p2', 20], ['p4', 20], ['p14', 20], ['p1', 15]], mkt: [['p5', 50], ['p12', 30]], qa: [['p1', 25], ['p2', 30], ['p4', 25]] };
  for (let m = -2; m <= 0; m++) {
    for (const e of emp) {
      const key = Object.keys(RES).find((k) => RES[k] === e.id)!;
      const rows = (plan[key] ?? []).map(([pk, pct]) => ({ projectId: P[pk], method: 'PERCENT' as const, value: pct, notes: null }));
      if (rows.length) await run((t) => setEmployeeAllocation(t, ctx, { resourceId: e.id, month: mo(m, 1), rows } as never));
    }
  }

  // deals
  const dealCtx = ctx;
  const mkDeal = (i: Record<string, unknown>) => run((t) => createDeal(t, dealCtx, dealBody.parse(i)));
  const d1 = await mkDeal({ name: 'Kite Studios OTT Portal', clientId: C[10], serviceId: svc.web, scenarios: [{ name: 'Standard', sellingPrice: '650000', costLines: [{ categoryId: cc.dev, name: 'Development', amount: '300000' }, { categoryId: cc.des, name: 'Design', amount: '90000' }] }, { name: 'Premium', sellingPrice: '900000', costLines: [{ categoryId: cc.dev, name: 'Development', amount: '420000' }, { categoryId: cc.des, name: 'Design', amount: '130000' }, { categoryId: cc.third, name: 'Video CDN', amount: '60000' }] }] });
  await mkDeal({ name: 'Lumen Solar Dealer App', clientId: C[11], serviceId: svc.app, scenarios: [{ name: 'MVP', sellingPrice: '520000', costLines: [{ categoryId: cc.dev, name: 'Development', amount: '260000' }, { categoryId: cc.qa, name: 'QA', amount: '40000' }] }] });
  const d3 = await mkDeal({ name: 'Unsigned Prospect - Zen Yoga', clientName: 'Zen Yoga Studios', serviceId: svc.dm, scenarios: [{ name: 'Launch package', sellingPrice: '140000', costLines: [{ categoryId: cc.mkt, name: 'Campaign', amount: '70000' }] }] });
  const d4 = await mkDeal({ name: 'Indus Alumni Portal', clientId: C[8], serviceId: svc.web, scenarios: [{ name: 'Base', sellingPrice: '310000', costLines: [{ categoryId: cc.dev, name: 'Development', amount: '150000' }] }] });
  await run((t) => convertDeal(t, ctx, d1.id, { startDate: mo(1, 1), endDate: mo(5, 28) }));
  await run((t) => markLost(t, ctx, d4.id, 'Went with an in-house team'));
  void d3;

  // pending approvals, alerts, notifications
  for (const id of Object.values(P)) await run((t) => evaluateProjectAlerts(t, id));
  await run((t) => runNotificationScan(t));

  await flagDemo(started);
  const [counts] = (await db.execute(sql`SELECT
    (SELECT count(*) FROM projects WHERE is_demo)::int AS projects, (SELECT count(*) FROM clients WHERE is_demo)::int AS clients, (SELECT count(*) FROM project_costs WHERE is_demo)::int AS costs,
    (SELECT count(*) FROM invoices WHERE is_demo)::int AS invoices, (SELECT count(*) FROM payments WHERE is_demo)::int AS payments, (SELECT count(*) FROM expenses WHERE is_demo)::int AS expenses`)).rows as Record<string, number>[];
  log(`Demo data created: ${JSON.stringify(counts)}`);
  log('');
  log('Demo sign-in (all demo users share one password):');
  log(`  Super Admin      admin@demo.portal`);
  log(`  Finance          finance@demo.portal`);
  log(`  Project Manager  pm@demo.portal / pm2@demo.portal`);
  log(`  Team Member      member@demo.portal`);
  log(`  Viewer           viewer@demo.portal`);
  log(`  Admin            ops@demo.portal`);
  log(`  Password         ${DEMO_PASSWORD}`);
  log('Demo users must be deleted/disabled before real use: `npm run db:remove-demo`.');
  void systemUser; void finCtx; void tx; void payments; void projectCosts; void expenses; void recurringRules; void retainers; void deals; void employeeAllocations;
}

function SYSTEM_ACTOR_FOR(userId: string) { return { ...SYSTEM_ACTOR, userId, email: 'seed@demo.portal' }; }

main().catch(async (e) => { console.error('Seed failed:', e); await closeDb().catch(() => {}); process.exit(1); });
