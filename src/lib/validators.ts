/** Request-body schemas shared by API routes (Next.js route files may only export handlers). */
import { z } from 'zod';
import {
  ACTIVE_STATUSES, ALLOC_TARGET_TYPES, ALLOCATION_METHODS, BILLING_FREQUENCIES, CATEGORY_KINDS, COST_KINDS, EMP_ALLOC_METHODS, EXPENSE_SCOPES,
  INVOICE_TYPES, MILESTONE_STATUSES, PAYMENT_KINDS, PAYMENT_METHODS, PRIORITIES, PROJECT_STATUSES, PROJECT_TYPES, RECURRENCES, RECURRING_FREQUENCIES,
  RESOURCE_TYPES, TAX_MODES, COST_STATUSES,
} from '@/db/schema';
import { currency, dateStr, email, gstin, moneyStr, nonNegMoney, num, optDate, optText, optUuid, positiveMoney, reqText, uuid, version } from './schemas';

// ───────────── clients / vendors / categories ─────────────
export const clientBody = z.object({
  companyName: reqText(150),
  contactPerson: optText(120),
  email,
  phone: optText(40),
  website: optText(200),
  industry: optText(100),
  address: optText(500),
  gstin,
  country: z.string().trim().min(1).max(80).default('India'),
  currency: currency.default('INR'),
  notes: optText(2000),
});

export const vendorBody = z.object({
  name: reqText(150),
  contactName: optText(120),
  email,
  phone: optText(40),
  gstin,
  category: optText(80),
  notes: optText(2000),
});

export const categoryBody = z.object({
  kind: z.enum(CATEGORY_KINDS),
  name: reqText(80),
});

// ───────────── resources ─────────────
export const resourceBody = z.object({
  name: reqText(120),
  role: reqText(120),
  type: z.enum(RESOURCE_TYPES),
  hourlyCost: nonNegMoney.default('0'),
  dailyCost: nonNegMoney.default('0'),
  monthlyCost: nonNegMoney.default('0'),
  billingRate: nonNegMoney.default('0'),
  email,
  phone: optText(40),
  department: optText(80),
  status: z.enum(ACTIVE_STATUSES).default('ACTIVE'),
  startDate: optDate,
  endDate: optDate,
  notes: optText(2000),
});

// ───────────── projects ─────────────
export const milestoneInput = z.object({
  name: reqText(150),
  description: optText(1000),
  price: nonNegMoney.default('0'),
  cost: nonNegMoney.default('0'),
  startDate: optDate,
  dueDate: optDate,
  status: z.enum(MILESTONE_STATUSES).default('NOT_STARTED'),
});

export const scheduleItemInput = z.object({
  type: z.enum(INVOICE_TYPES).default('CUSTOM'),
  label: optText(150),
  /** either a percentage of the contract value OR a fixed amount */
  pct: z.coerce.number().min(0).max(100).optional(),
  amount: nonNegMoney.optional(),
  dueDate: dateStr,
  milestoneIndex: z.coerce.number().int().min(0).optional(),
});

export const projectBody = z.object({
  name: reqText(150),
  clientId: uuid,
  serviceId: uuid,
  type: z.enum(PROJECT_TYPES),
  description: optText(4000),
  managerId: optUuid,
  salesOwnerId: optUuid,
  startDate: optDate,
  endDate: optDate,
  contractDate: optDate,
  priority: z.enum(PRIORITIES).default('MEDIUM'),
  status: z.enum(PROJECT_STATUSES).default('LEAD'),
  currency: currency.optional(),
  fxRateToBase: z.coerce.number().positive().max(1e6).optional(),
  taxMode: z.enum(TAX_MODES).default('EXCLUSIVE'),
  taxRatePct: z.coerce.number().min(0).max(100).optional(),
  sellingPrice: nonNegMoney.default('0'),
  discount: nonNegMoney.default('0'),
  setupFee: nonNegMoney.default('0'),
  monthlyFee: nonNegMoney.default('0'),
  durationMonths: z.coerce.number().int().min(0).max(240).default(0),
  paymentTerms: optText(200),
  notes: optText(4000),
  budget: nonNegMoney.default('0'),
  memberIds: z.array(uuid).max(100).optional(),
  // creation helpers
  milestones: z.array(milestoneInput).max(100).optional(),
  categoryBudgets: z.array(z.object({ categoryId: uuid, amount: nonNegMoney })).max(60).optional(),
  paymentSchedule: z.array(scheduleItemInput).max(60).optional(),
  estimatedCosts: z.array(z.object({ categoryId: uuid, name: reqText(150), amount: positiveMoney })).max(100).optional(),
  /** RETAINER only */
  retainer: z.object({
    monthlyFee: positiveMoney,
    startDate: dateStr,
    endDate: dateStr,
    includedHours: num(0, 100000).default(0),
    overageRate: nonNegMoney.default('0'),
    billingFrequency: z.enum(BILLING_FREQUENCIES).default('MONTHLY'),
    accountManagerId: optUuid,
  }).optional(),
});

export const projectPatch = projectBody
  .omit({ milestones: true, categoryBudgets: true, paymentSchedule: true, estimatedCosts: true, retainer: true, status: true, budget: true })
  .partial()
  .extend({ version });

// ───────────── costs ─────────────
export const costBody = z.object({
  projectId: uuid,
  name: reqText(150),
  categoryId: uuid,
  description: optText(2000),
  kind: z.enum(COST_KINDS).default('ACTUAL'),
  amount: moneyStr,
  currency: currency.optional(),
  fxRate: z.coerce.number().positive().max(1e6).optional(),
  isCredit: z.boolean().default(false),
  date: dateStr,
  vendorId: optUuid,
  resourceId: optUuid,
  recurrence: z.enum(RECURRENCES).default('NONE'),
  recurrenceIntervalMonths: z.coerce.number().int().min(1).max(60).nullish(),
  recurrenceEnds: optDate,
  status: z.enum(COST_STATUSES).optional(),
  notes: optText(2000),
  /** request to save even though it breaks the budget (needs costs.approve, else becomes an approval request) */
  overrideBudget: z.boolean().default(false),
  overrideReason: optText(500),
});
export const costPatch = costBody.omit({ projectId: true }).partial().extend({ version });

// ───────────── billing ─────────────
export const invoiceBody = z.object({
  projectId: uuid,
  type: z.enum(INVOICE_TYPES).default('CUSTOM'),
  milestoneId: optUuid,
  description: optText(500),
  status: z.enum(['SCHEDULED', 'ISSUED']).default('ISSUED'),
  issueDate: optDate,
  dueDate: dateStr,
  /** amount BEFORE tax; tax is computed from the project's tax settings unless taxAmount is given */
  subtotal: positiveMoney,
  taxAmount: nonNegMoney.optional(),
  periodStart: optDate,
  number: z.string().trim().min(1).max(40).optional(),
});
export const paymentBody = z.object({
  projectId: uuid.optional(),
  invoiceId: optUuid,
  kind: z.enum(PAYMENT_KINDS).default('RECEIPT'),
  amount: positiveMoney,
  tdsAmount: nonNegMoney.default('0'),
  receivedDate: dateStr,
  method: z.enum(PAYMENT_METHODS).default('BANK_TRANSFER'),
  reference: optText(120),
  notes: optText(1000),
});

// ───────────── expenses ─────────────
export const expenseBody = z.object({
  date: dateStr,
  categoryId: uuid,
  description: reqText(300),
  amount: positiveMoney,
  taxAmount: nonNegMoney.default('0'),
  currency: currency.optional(),
  fxRate: z.coerce.number().positive().max(1e6).optional(),
  vendorId: optUuid,
  paymentMethod: z.enum(PAYMENT_METHODS).default('BANK_TRANSFER'),
  scope: z.enum(EXPENSE_SCOPES).default('COMPANY'),
  projectId: optUuid,
  department: optText(80),
  reference: optText(120),
  notes: optText(2000),
  recurringRuleId: optUuid,
  costCategoryId: optUuid,
  overrideBudget: z.boolean().default(false),
  overrideReason: optText(500),
});
export const expensePatch = expenseBody.partial().extend({ version, status: z.enum(['EXPECTED', 'APPROVED']).optional() });

export const allocationRow = z.object({
  targetType: z.enum(ALLOC_TARGET_TYPES),
  projectId: optUuid,
  department: optText(80),
  method: z.enum(ALLOCATION_METHODS),
  value: z.coerce.number().min(0).max(1e13).default(0),
});
export const expenseAllocationBody = z.object({ rows: z.array(allocationRow).max(50) });

export const employeeAllocationBody = z.object({
  resourceId: uuid,
  month: dateStr,
  rows: z
    .array(z.object({ projectId: optUuid, method: z.enum(EMP_ALLOC_METHODS), value: z.coerce.number().min(0).max(1e13), notes: optText(300) }))
    .max(50),
});

export const recurringBody = z.object({
  name: reqText(150),
  categoryId: uuid,
  vendorId: optUuid,
  projectId: optUuid,
  department: optText(80),
  scope: z.enum(EXPENSE_SCOPES).default('COMPANY'),
  amount: positiveMoney,
  taxAmount: nonNegMoney.default('0'),
  frequency: z.enum(RECURRING_FREQUENCIES),
  intervalMonths: z.coerce.number().int().min(1).max(60).default(1),
  startDate: dateStr,
  endDate: optDate,
  active: z.boolean().default(true),
  notes: optText(1000),
});

// ───────────── retainers ─────────────
export const retainerCreate = z.object({
  name: reqText(150),
  clientId: uuid,
  serviceId: uuid,
  monthlyFee: positiveMoney,
  startDate: dateStr,
  endDate: dateStr,
  billingFrequency: z.enum(BILLING_FREQUENCIES).default('MONTHLY'),
  includedHours: num(0, 100000).default(0),
  overageRate: nonNegMoney.default('0'),
  accountManagerId: optUuid,
  taxMode: z.enum(TAX_MODES).default('EXCLUSIVE'),
  taxRatePct: z.coerce.number().min(0).max(100).default(18),
  budget: nonNegMoney.default('0'),
  notes: optText(2000),
});

// ───────────── deals ─────────────
export const dealBody = z.object({
  name: reqText(150),
  clientId: optUuid,
  clientName: optText(150),
  serviceId: optUuid,
  ownerId: optUuid,
  notes: optText(2000),
  scenarios: z
    .array(
      z.object({
        id: optUuid,
        name: reqText(60),
        sellingPrice: nonNegMoney,
        costLines: z.array(z.object({ categoryId: uuid, name: reqText(120), amount: nonNegMoney })).max(60),
      }),
    )
    .max(6)
    .optional(),
});
