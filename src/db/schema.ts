/**
 * Finance Portal database schema (Drizzle ORM / PostgreSQL).
 *
 * Conventions
 *  - UUID primary keys (gen_random_uuid()).
 *  - Money: numeric(16,2) returned as *strings* (exact). Convert to integer minor units (paise)
 *    with `toMinor()` from lib/money before doing arithmetic. Never use JS floats for money.
 *  - Dates without time: `date` columns in string mode ("YYYY-MM-DD") -> no timezone drift.
 *  - Financial rows are never hard-deleted: archivedAt / status CANCELLED|VOID + audit log.
 */
import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

// ───────────────────────────── Enum value lists (shared with zod validation) ─────────────────────────────

export const CATEGORY_KINDS = ['SERVICE', 'COST', 'EXPENSE'] as const;
export const PROJECT_TYPES = ['ONE_TIME', 'RETAINER', 'MILESTONE', 'HOURLY', 'FIXED_RECURRING'] as const;
export const PROJECT_STATUSES = ['LEAD', 'PROPOSAL', 'NEGOTIATION', 'WON', 'ONBOARDING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED', 'LOST'] as const;
export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export const TAX_MODES = ['EXCLUSIVE', 'INCLUSIVE', 'NONE'] as const;
export const RESOURCE_TYPES = ['EMPLOYEE', 'FREELANCER', 'CONTRACTOR', 'AGENCY', 'VENDOR'] as const;
export const ACTIVE_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export const COST_KINDS = ['ESTIMATED', 'COMMITTED', 'ACTUAL'] as const;
export const COST_STATUSES = ['PLANNED', 'PENDING_APPROVAL', 'APPROVED', 'PAID', 'REJECTED', 'CANCELLED', 'FULFILLED'] as const;
export const RECURRENCES = ['NONE', 'MONTHLY', 'QUARTERLY', 'YEARLY', 'CUSTOM'] as const;
export const INVOICE_STATUSES = ['SCHEDULED', 'ISSUED', 'CANCELLED'] as const;
export const INVOICE_TYPES = ['ADVANCE', 'MILESTONE', 'MONTHLY', 'QUARTERLY', 'FINAL', 'CUSTOM'] as const;
export const PAYMENT_KINDS = ['RECEIPT', 'REFUND'] as const;
export const PAYMENT_METHODS = ['BANK_TRANSFER', 'UPI', 'CHEQUE', 'CASH', 'CARD', 'OTHER'] as const;
export const EXPENSE_STATUSES = ['EXPECTED', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'VOID'] as const;
export const EXPENSE_SCOPES = ['PROJECT', 'COMPANY', 'DEPARTMENT'] as const;
export const ALLOCATION_METHODS = ['FIXED', 'PERCENT', 'HOURS', 'REVENUE_PERCENT'] as const;
export const ALLOC_TARGET_TYPES = ['PROJECT', 'DEPARTMENT', 'OVERHEAD'] as const;
export const EMP_ALLOC_METHODS = ['PERCENT', 'HOURS', 'DAYS', 'MANUAL'] as const;
export const RETAINER_STATUSES = ['ACTIVE', 'PAUSED', 'CANCELLED', 'COMPLETED'] as const;
export const BILLING_FREQUENCIES = ['MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY'] as const;
export const RECURRING_FREQUENCIES = ['MONTHLY', 'QUARTERLY', 'YEARLY', 'CUSTOM'] as const;
export const DEAL_STATUSES = ['OPEN', 'WON', 'LOST'] as const;
export const MILESTONE_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED'] as const;
export const APPROVAL_TYPES = ['NEW_PROJECT', 'LARGE_EXPENSE', 'BUDGET_INCREASE', 'VENDOR_EXPENSE', 'DISCOUNT', 'PROJECT_CANCELLATION', 'COST_THRESHOLD', 'OVER_BUDGET', 'COST_CHANGE'] as const;
export const APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export const ATTACHMENT_ENTITIES = ['PROJECT', 'CLIENT', 'COST', 'EXPENSE', 'INVOICE', 'PAYMENT', 'DEAL'] as const;
export const IMPORT_KINDS = ['CLIENTS', 'PROJECTS', 'EXPENSES', 'RESOURCES', 'COSTS'] as const;
export const IMPORT_STATUSES = ['VALIDATED', 'COMMITTED', 'DISCARDED'] as const;

export const categoryKind = pgEnum('category_kind', CATEGORY_KINDS);
export const projectType = pgEnum('project_type', PROJECT_TYPES);
export const projectStatus = pgEnum('project_status', PROJECT_STATUSES);
export const priority = pgEnum('priority', PRIORITIES);
export const taxMode = pgEnum('tax_mode', TAX_MODES);
export const resourceType = pgEnum('resource_type', RESOURCE_TYPES);
export const activeStatus = pgEnum('active_status', ACTIVE_STATUSES);
export const costKind = pgEnum('cost_kind', COST_KINDS);
export const costStatus = pgEnum('cost_status', COST_STATUSES);
export const recurrence = pgEnum('recurrence', RECURRENCES);
export const invoiceStatus = pgEnum('invoice_status', INVOICE_STATUSES);
export const invoiceType = pgEnum('invoice_type', INVOICE_TYPES);
export const paymentKind = pgEnum('payment_kind', PAYMENT_KINDS);
export const paymentMethod = pgEnum('payment_method', PAYMENT_METHODS);
export const expenseStatus = pgEnum('expense_status', EXPENSE_STATUSES);
export const expenseScope = pgEnum('expense_scope', EXPENSE_SCOPES);
export const allocationMethod = pgEnum('allocation_method', ALLOCATION_METHODS);
export const allocTargetType = pgEnum('alloc_target_type', ALLOC_TARGET_TYPES);
export const empAllocMethod = pgEnum('emp_alloc_method', EMP_ALLOC_METHODS);
export const retainerStatus = pgEnum('retainer_status', RETAINER_STATUSES);
export const billingFrequency = pgEnum('billing_frequency', BILLING_FREQUENCIES);
export const recurringFrequency = pgEnum('recurring_frequency', RECURRING_FREQUENCIES);
export const dealStatus = pgEnum('deal_status', DEAL_STATUSES);
export const milestoneStatus = pgEnum('milestone_status', MILESTONE_STATUSES);
export const approvalType = pgEnum('approval_type', APPROVAL_TYPES);
export const approvalStatus = pgEnum('approval_status', APPROVAL_STATUSES);
export const attachmentEntity = pgEnum('attachment_entity', ATTACHMENT_ENTITIES);
export const importKind = pgEnum('import_kind', IMPORT_KINDS);
export const importStatus = pgEnum('import_status', IMPORT_STATUSES);

// ───────────────────────────── Column helpers ─────────────────────────────

const pk = () => uuid('id').primaryKey().defaultRandom();
const money = (name: string) => numeric(name, { precision: 16, scale: 2 });
const rate = (name: string) => numeric(name, { precision: 12, scale: 2 });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => ts('created_at').notNull().defaultNow();
const updatedAt = () => ts('updated_at').notNull().defaultNow().$onUpdate(() => new Date());
const d = (name: string) => date(name, { mode: 'string' });

// ───────────────────────────── Company & settings ─────────────────────────────

export const company = pgTable('company', {
  id: text('id').primaryKey().default('singleton'),
  name: text('name').notNull(),
  legalName: text('legal_name'),
  gstin: varchar('gstin', { length: 15 }),
  pan: varchar('pan', { length: 10 }),
  stateCode: varchar('state_code', { length: 2 }),
  address: text('address'),
  email: text('email'),
  phone: text('phone'),
  baseCurrency: varchar('base_currency', { length: 3 }).notNull().default('INR'),
  fyStartMonth: integer('fy_start_month').notNull().default(4),
  dateFormat: text('date_format').notNull().default('DD/MM/YYYY'),
  numberFormat: text('number_format').notNull().default('en-IN'),
  setupComplete: boolean('setup_complete').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Key/value JSON settings: thresholds, approval rules, notification toggles ... */
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: updatedAt(),
  updatedBy: uuid('updated_by'),
});

export const taxRates = pgTable('tax_rates', {
  id: pk(),
  name: text('name').notNull().unique(),
  ratePct: numeric('rate_pct', { precision: 6, scale: 3 }).notNull(),
  isDefault: boolean('is_default').notNull().default(false),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
});

export const paymentTerms = pgTable('payment_terms', {
  id: pk(),
  name: text('name').notNull().unique(),
  days: integer('days').notNull(),
  description: text('description'),
  active: boolean('active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const exchangeRates = pgTable(
  'exchange_rates',
  {
    id: pk(),
    currency: varchar('currency', { length: 3 }).notNull(),
    rateToBase: numeric('rate_to_base', { precision: 18, scale: 8 }).notNull(),
    effectiveOn: d('effective_on').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('exchange_rates_currency_effective_uq').on(t.currency, t.effectiveOn), check('exchange_rate_positive', sql`${t.rateToBase} > 0`)],
);

/** One table for service categories, project-cost categories and expense categories. */
export const categories = pgTable(
  'categories',
  {
    id: pk(),
    kind: categoryKind('kind').notNull(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    active: boolean('active').notNull().default(true),
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('categories_kind_slug_uq').on(t.kind, t.slug), index('categories_kind_active_idx').on(t.kind, t.active, t.sortOrder)],
);

// ───────────────────────────── Users, roles, sessions ─────────────────────────────

export const roles = pgTable('roles', {
  id: pk(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  isSystem: boolean('is_system').notNull().default(false),
  createdAt: createdAt(),
});

export const permissions = pgTable('permissions', {
  id: pk(),
  key: text('key').notNull().unique(),
  group: text('group').notNull(),
  description: text('description').notNull(),
});

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: uuid('permission_id').notNull().references(() => permissions.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionId] })],
);

export const users = pgTable(
  'users',
  {
    id: pk(),
    email: text('email').notNull().unique(),
    name: text('name').notNull(),
    passwordHash: text('password_hash').notNull(),
    roleId: uuid('role_id').notNull().references(() => roles.id),
    active: boolean('active').notNull().default(true),
    failedLogins: integer('failed_logins').notNull().default(0),
    lockedUntil: ts('locked_until'),
    lastLoginAt: ts('last_login_at'),
    mustChangePw: boolean('must_change_pw').notNull().default(false),
    notifyPrefs: jsonb('notify_prefs').notNull().default(sql`'{}'::jsonb`),
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('users_role_idx').on(t.roleId)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: pk(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    csrfToken: text('csrf_token').notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
  },
  (t) => [index('sessions_user_idx').on(t.userId), index('sessions_expires_idx').on(t.expiresAt)],
);

// ───────────────────────────── Clients, vendors, resources ─────────────────────────────

export const clients = pgTable(
  'clients',
  {
    id: pk(),
    companyName: text('company_name').notNull(),
    contactPerson: text('contact_person'),
    email: text('email'),
    phone: text('phone'),
    website: text('website'),
    industry: text('industry'),
    address: text('address'),
    gstin: varchar('gstin', { length: 15 }),
    stateCode: varchar('state_code', { length: 2 }),
    country: text('country').notNull().default('India'),
    currency: varchar('currency', { length: 3 }).notNull().default('INR'),
    notes: text('notes'),
    isDemo: boolean('is_demo').notNull().default(false),
    archivedAt: ts('archived_at'),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('clients_name_idx').on(t.companyName),
    index('clients_archived_idx').on(t.archivedAt),
    // duplicate-client protection (case-insensitive name among non-archived)
    uniqueIndex('clients_name_active_uq').on(sql`lower(${t.companyName})`).where(sql`${t.archivedAt} is null`),
  ],
);

export const vendors = pgTable(
  'vendors',
  {
    id: pk(),
    name: text('name').notNull(),
    contactName: text('contact_name'),
    email: text('email'),
    phone: text('phone'),
    gstin: varchar('gstin', { length: 15 }),
    category: text('category'),
    notes: text('notes'),
    isDemo: boolean('is_demo').notNull().default(false),
    archivedAt: ts('archived_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('vendors_name_idx').on(t.name), uniqueIndex('vendors_name_active_uq').on(sql`lower(${t.name})`).where(sql`${t.archivedAt} is null`)],
);

/** Employees, freelancers, contractors, agencies, vendors: anyone who can be costed. */
export const resources = pgTable(
  'resources',
  {
    id: pk(),
    name: text('name').notNull(),
    role: text('role').notNull(),
    type: resourceType('type').notNull(),
    hourlyCost: rate('hourly_cost').notNull().default('0'),
    dailyCost: rate('daily_cost').notNull().default('0'),
    monthlyCost: rate('monthly_cost').notNull().default('0'),
    billingRate: rate('billing_rate').notNull().default('0'),
    email: text('email'),
    phone: text('phone'),
    department: text('department'),
    status: activeStatus('status').notNull().default('ACTIVE'),
    startDate: d('start_date'),
    endDate: d('end_date'),
    userId: uuid('user_id').references(() => users.id),
    notes: text('notes'),
    isDemo: boolean('is_demo').notNull().default(false),
    archivedAt: ts('archived_at'),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('resources_type_status_idx').on(t.type, t.status), index('resources_name_idx').on(t.name), check('resource_rates_nonneg', sql`${t.hourlyCost} >= 0 and ${t.dailyCost} >= 0 and ${t.monthlyCost} >= 0 and ${t.billingRate} >= 0`)],
);

export const resourceRateHistory = pgTable(
  'resource_rate_history',
  {
    id: pk(),
    resourceId: uuid('resource_id').notNull().references(() => resources.id, { onDelete: 'cascade' }),
    effectiveOn: d('effective_on').notNull(),
    hourlyCost: rate('hourly_cost').notNull(),
    dailyCost: rate('daily_cost').notNull(),
    monthlyCost: rate('monthly_cost').notNull(),
    billingRate: rate('billing_rate').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('rate_hist_resource_idx').on(t.resourceId, t.effectiveOn)],
);

// ───────────────────────────── Projects ─────────────────────────────

export const projects = pgTable(
  'projects',
  {
    id: pk(),
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    clientId: uuid('client_id').notNull().references(() => clients.id),
    serviceId: uuid('service_id').notNull().references(() => categories.id),
    type: projectType('type').notNull(),
    description: text('description'),
    managerId: uuid('manager_id').references(() => users.id),
    salesOwnerId: uuid('sales_owner_id').references(() => users.id),
    startDate: d('start_date'),
    endDate: d('end_date'),
    contractDate: d('contract_date'),
    priority: priority('priority').notNull().default('MEDIUM'),
    status: projectStatus('status').notNull().default('LEAD'),
    currency: varchar('currency', { length: 3 }).notNull().default('INR'),
    /** converts this project's currency into the company base currency (snapshot at creation/edit) */
    fxRateToBase: numeric('fx_rate_to_base', { precision: 18, scale: 8 }).notNull().default('1'),
    taxMode: taxMode('tax_mode').notNull().default('EXCLUSIVE'),
    taxRatePct: numeric('tax_rate_pct', { precision: 6, scale: 3 }).notNull().default('18'),
    sellingPrice: money('selling_price').notNull().default('0'),
    discount: money('discount').notNull().default('0'),
    /** FIXED_RECURRING: setupFee (one-time) + monthlyFee x durationMonths */
    setupFee: money('setup_fee').notNull().default('0'),
    monthlyFee: money('monthly_fee').notNull().default('0'),
    durationMonths: integer('duration_months').notNull().default(0),
    paymentTerms: text('payment_terms'),
    notes: text('notes'),
    /** overall approved cost budget; 0 = no budget set */
    budget: money('budget').notNull().default('0'),
    isDemo: boolean('is_demo').notNull().default(false),
    archivedAt: ts('archived_at'),
    cancelledAt: ts('cancelled_at'),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('projects_client_idx').on(t.clientId),
    index('projects_service_idx').on(t.serviceId),
    index('projects_manager_idx').on(t.managerId),
    index('projects_status_idx').on(t.status, t.archivedAt),
    index('projects_type_idx').on(t.type),
    index('projects_start_idx').on(t.startDate),
    index('projects_created_idx').on(t.createdAt),
    index('projects_name_idx').on(t.name),
    check('project_money_nonneg', sql`${t.discount} >= 0 and ${t.budget} >= 0 and ${t.setupFee} >= 0 and ${t.monthlyFee} >= 0`),
    check('project_selling_price_nonneg', sql`${t.sellingPrice} >= 0`),
    check('project_dates_order', sql`${t.endDate} is null or ${t.startDate} is null or ${t.endDate} >= ${t.startDate}`),
    check('project_fx_positive', sql`${t.fxRateToBase} > 0`),
    check('project_tax_range', sql`${t.taxRatePct} >= 0 and ${t.taxRatePct} <= 100`),
  ],
);

export const projectMembers = pgTable(
  'project_members',
  {
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId] }), index('project_members_user_idx').on(t.userId)],
);

export const projectBudgets = pgTable(
  'project_budgets',
  {
    id: pk(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id').notNull().references(() => categories.id),
    amount: money('amount').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('project_budgets_uq').on(t.projectId, t.categoryId), check('project_budget_nonneg', sql`${t.amount} >= 0`)],
);

export const milestones = pgTable(
  'milestones',
  {
    id: pk(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    price: money('price').notNull().default('0'),
    cost: money('cost').notNull().default('0'),
    startDate: d('start_date'),
    dueDate: d('due_date'),
    status: milestoneStatus('status').notNull().default('NOT_STARTED'),
    sortOrder: integer('sort_order').notNull().default(0),
    archivedAt: ts('archived_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('milestones_project_idx').on(t.projectId), check('milestone_nonneg', sql`${t.price} >= 0 and ${t.cost} >= 0`)],
);

/** Estimated / committed / actual cost lines of a project. */
export const projectCosts = pgTable(
  'project_costs',
  {
    id: pk(),
    projectId: uuid('project_id').notNull().references(() => projects.id),
    name: text('name').notNull(),
    categoryId: uuid('category_id').notNull().references(() => categories.id),
    description: text('description'),
    kind: costKind('kind').notNull().default('ACTUAL'),
    status: costStatus('status').notNull().default('APPROVED'),
    /** in the PROJECT currency; used for every calculation. Negative only when isCredit. */
    amount: money('amount').notNull(),
    originalAmount: money('original_amount').notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    fxRate: numeric('fx_rate', { precision: 18, scale: 8 }).notNull().default('1'),
    isCredit: boolean('is_credit').notNull().default(false),
    date: d('date').notNull(),
    vendorId: uuid('vendor_id').references(() => vendors.id),
    resourceId: uuid('resource_id').references(() => resources.id),
    recurrence: recurrence('recurrence').notNull().default('NONE'),
    recurrenceIntervalMonths: integer('recurrence_interval_months'),
    recurrenceEnds: d('recurrence_ends'),
    notes: text('notes'),
    /** set when mirrored from a project-specific Expense (the Expense stays the source of truth) */
    expenseId: uuid('expense_id').references(() => expenses.id),
    overrideReason: text('override_reason'),
    isDemo: boolean('is_demo').notNull().default(false),
    archivedAt: ts('archived_at'),
    version: integer('version').notNull().default(1),
    createdById: uuid('created_by_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('costs_project_kind_idx').on(t.projectId, t.kind, t.status, t.archivedAt),
    index('costs_project_date_idx').on(t.projectId, t.date),
    index('costs_category_idx').on(t.categoryId),
    index('costs_date_idx').on(t.date),
    index('costs_vendor_idx').on(t.vendorId),
    index('costs_resource_idx').on(t.resourceId),
    uniqueIndex('costs_expense_uq').on(t.expenseId).where(sql`${t.expenseId} is not null`),
    check('cost_amount_valid', sql`(${t.isCredit} and ${t.amount} < 0) or (not ${t.isCredit} and ${t.amount} > 0)`),
    check('cost_fx_positive', sql`${t.fxRate} > 0`),
  ],
);

/** Resource assignment on a project (hours x rates, rates snapshotted at assignment). */
export const projectResources = pgTable(
  'project_resources',
  {
    id: pk(),
    projectId: uuid('project_id').notNull().references(() => projects.id),
    resourceId: uuid('resource_id').notNull().references(() => resources.id),
    plannedHours: numeric('planned_hours', { precision: 10, scale: 2 }).notNull().default('0'),
    actualHours: numeric('actual_hours', { precision: 10, scale: 2 }).notNull().default('0'),
    costRate: rate('cost_rate').notNull(),
    billingRate: rate('billing_rate').notNull().default('0'),
    paidAmount: money('paid_amount').notNull().default('0'),
    startDate: d('start_date'),
    endDate: d('end_date'),
    notes: text('notes'),
    archivedAt: ts('archived_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('pr_project_idx').on(t.projectId),
    index('pr_resource_idx').on(t.resourceId),
    check('pr_nonneg', sql`${t.plannedHours} >= 0 and ${t.actualHours} >= 0 and ${t.costRate} >= 0 and ${t.billingRate} >= 0 and ${t.paidAmount} >= 0`),
  ],
);

/** Signed revenue adjustments (scope change, credit note...). */
export const projectAdjustments = pgTable(
  'project_adjustments',
  {
    id: pk(),
    projectId: uuid('project_id').notNull().references(() => projects.id),
    amount: money('amount').notNull(),
    reason: text('reason').notNull(),
    date: d('date').notNull(),
    createdById: uuid('created_by_id'),
    archivedAt: ts('archived_at'),
    createdAt: createdAt(),
  },
  (t) => [index('adj_project_idx').on(t.projectId), check('adj_nonzero', sql`${t.amount} <> 0`)],
);

// ───────────────────────────── Billing ─────────────────────────────

export const invoices = pgTable(
  'invoices',
  {
    id: pk(),
    projectId: uuid('project_id').notNull().references(() => projects.id),
    number: text('number').notNull().unique(),
    type: invoiceType('type').notNull().default('CUSTOM'),
    milestoneId: uuid('milestone_id').references(() => milestones.id),
    description: text('description'),
    status: invoiceStatus('status').notNull().default('ISSUED'),
    issueDate: d('issue_date'),
    dueDate: d('due_date').notNull(),
    subtotal: money('subtotal').notNull(),
    cgst: money('cgst').notNull().default('0'),
    sgst: money('sgst').notNull().default('0'),
    igst: money('igst').notNull().default('0'),
    taxAmount: money('tax_amount').notNull().default('0'),
    total: money('total').notNull(),
    periodStart: d('period_start'),
    cancelledAt: ts('cancelled_at'),
    cancelReason: text('cancel_reason'),
    isDemo: boolean('is_demo').notNull().default(false),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('invoices_project_status_idx').on(t.projectId, t.status),
    index('invoices_due_idx').on(t.dueDate, t.status),
    index('invoices_issue_idx').on(t.issueDate),
    // one live invoice per billing period of a project (retainer generation is idempotent by construction)
    uniqueIndex('invoices_period_uq').on(t.projectId, t.periodStart).where(sql`${t.periodStart} is not null and ${t.status} <> 'CANCELLED'`),
    check('invoice_amounts_valid', sql`${t.subtotal} >= 0 and ${t.taxAmount} >= 0 and ${t.total} >= 0`),
  ],
);

export const payments = pgTable(
  'payments',
  {
    id: pk(),
    projectId: uuid('project_id').notNull().references(() => projects.id),
    /** null = payment received before an invoice existed (unapplied advance) */
    invoiceId: uuid('invoice_id').references(() => invoices.id),
    kind: paymentKind('kind').notNull().default('RECEIPT'),
    amount: money('amount').notNull(),
    /** TDS deducted by the client: settles the invoice but is not cash */
    tdsAmount: money('tds_amount').notNull().default('0'),
    receivedDate: d('received_date').notNull(),
    method: paymentMethod('method').notNull().default('BANK_TRANSFER'),
    reference: text('reference'),
    notes: text('notes'),
    isDemo: boolean('is_demo').notNull().default(false),
    voidedAt: ts('voided_at'),
    voidReason: text('void_reason'),
    createdById: uuid('created_by_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('payments_project_idx').on(t.projectId, t.voidedAt),
    index('payments_invoice_idx').on(t.invoiceId),
    index('payments_received_idx').on(t.receivedDate),
    check('payment_amount_valid', sql`${t.amount} > 0 and ${t.tdsAmount} >= 0`),
  ],
);

// ───────────────────────────── Expenses & allocation ─────────────────────────────

export const recurringRules = pgTable(
  'recurring_rules',
  {
    id: pk(),
    name: text('name').notNull(),
    categoryId: uuid('category_id').notNull().references(() => categories.id),
    vendorId: uuid('vendor_id').references(() => vendors.id),
    projectId: uuid('project_id').references(() => projects.id),
    department: text('department'),
    scope: expenseScope('scope').notNull().default('COMPANY'),
    amount: money('amount').notNull(),
    taxAmount: money('tax_amount').notNull().default('0'),
    frequency: recurringFrequency('frequency').notNull(),
    intervalMonths: integer('interval_months').notNull().default(1),
    startDate: d('start_date').notNull(),
    endDate: d('end_date'),
    active: boolean('active').notNull().default(true),
    lastGeneratedThrough: d('last_generated_through'),
    notes: text('notes'),
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check('rule_valid', sql`${t.amount} > 0 and ${t.intervalMonths} >= 1`)],
);

export const expenses = pgTable(
  'expenses',
  {
    id: pk(),
    date: d('date').notNull(),
    categoryId: uuid('category_id').notNull().references(() => categories.id),
    description: text('description').notNull(),
    /** base currency, excluding tax */
    amount: money('amount').notNull(),
    taxAmount: money('tax_amount').notNull().default('0'),
    originalAmount: money('original_amount').notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    fxRate: numeric('fx_rate', { precision: 18, scale: 8 }).notNull().default('1'),
    vendorId: uuid('vendor_id').references(() => vendors.id),
    paymentMethod: paymentMethod('payment_method').notNull().default('BANK_TRANSFER'),
    scope: expenseScope('scope').notNull().default('COMPANY'),
    projectId: uuid('project_id').references(() => projects.id),
    department: text('department'),
    status: expenseStatus('status').notNull().default('APPROVED'),
    recurringRuleId: uuid('recurring_rule_id').references(() => recurringRules.id),
    periodStart: d('period_start'),
    reference: text('reference'),
    notes: text('notes'),
    isDemo: boolean('is_demo').notNull().default(false),
    archivedAt: ts('archived_at'),
    version: integer('version').notNull().default(1),
    createdById: uuid('created_by_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // duplicate recurring-expense prevention is enforced by the database
    uniqueIndex('expenses_rule_period_uq').on(t.recurringRuleId, t.periodStart).where(sql`${t.recurringRuleId} is not null`),
    index('expenses_date_idx').on(t.date, t.status, t.archivedAt),
    index('expenses_category_idx').on(t.categoryId),
    index('expenses_project_idx').on(t.projectId),
    index('expenses_scope_idx').on(t.scope),
    index('expenses_vendor_idx').on(t.vendorId),
    check('expense_amount_valid', sql`${t.amount} > 0 and ${t.taxAmount} >= 0`),
    check('expense_scope_project', sql`(${t.scope} <> 'PROJECT') or (${t.projectId} is not null)`),
    check('expense_fx_positive', sql`${t.fxRate} > 0`),
  ],
);

export const expenseAllocations = pgTable(
  'expense_allocations',
  {
    id: pk(),
    expenseId: uuid('expense_id').notNull().references(() => expenses.id, { onDelete: 'cascade' }),
    targetType: allocTargetType('target_type').notNull(),
    projectId: uuid('project_id').references(() => projects.id),
    department: text('department'),
    method: allocationMethod('method').notNull(),
    /** FIXED: amount; PERCENT: percentage; HOURS: hours; REVENUE_PERCENT: unused */
    value: numeric('value', { precision: 16, scale: 4 }).notNull().default('0'),
    /** computed allocated amount (base currency); recalculated whenever the set changes */
    amount: money('amount').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('ea_expense_idx').on(t.expenseId), index('ea_project_idx').on(t.projectId), check('ea_amount_nonneg', sql`${t.amount} >= 0 and ${t.value} >= 0`)],
);

/** Monthly allocation of an employee's cost to a project (or internal). */
export const employeeAllocations = pgTable(
  'employee_allocations',
  {
    id: pk(),
    resourceId: uuid('resource_id').notNull().references(() => resources.id),
    projectId: uuid('project_id').references(() => projects.id),
    /** 'INTERNAL' when projectId is null; keeps the unique index null-safe */
    projectKey: text('project_key').notNull(),
    month: d('month').notNull(),
    method: empAllocMethod('method').notNull(),
    value: numeric('value', { precision: 12, scale: 4 }).notNull(),
    monthlyCostSnapshot: money('monthly_cost_snapshot').notNull(),
    amount: money('amount').notNull(),
    notes: text('notes'),
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('emp_alloc_uq').on(t.resourceId, t.month, t.projectKey),
    index('emp_alloc_project_idx').on(t.projectId, t.month),
    index('emp_alloc_month_idx').on(t.month),
    check('emp_alloc_nonneg', sql`${t.amount} >= 0 and ${t.value} >= 0 and ${t.monthlyCostSnapshot} >= 0`),
  ],
);

// ───────────────────────────── Retainers ─────────────────────────────

export const retainers = pgTable(
  'retainers',
  {
    id: pk(),
    projectId: uuid('project_id').notNull().unique().references(() => projects.id),
    clientId: uuid('client_id').notNull().references(() => clients.id),
    serviceId: uuid('service_id').notNull().references(() => categories.id),
    accountManagerId: uuid('account_manager_id').references(() => users.id),
    billingFrequency: billingFrequency('billing_frequency').notNull().default('MONTHLY'),
    status: retainerStatus('status').notNull().default('ACTIVE'),
    /** effective end (cancelled / completed) */
    cancelledOn: d('cancelled_on'),
    notes: text('notes'),
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('retainers_status_idx').on(t.status)],
);

/** A fee term. Renewal adds a new term (possibly a new fee); history is never rewritten. */
export const retainerTerms = pgTable(
  'retainer_terms',
  {
    id: pk(),
    retainerId: uuid('retainer_id').notNull().references(() => retainers.id, { onDelete: 'cascade' }),
    monthlyFee: money('monthly_fee').notNull(),
    startDate: d('start_date').notNull(),
    endDate: d('end_date').notNull(),
    includedHours: numeric('included_hours', { precision: 10, scale: 2 }).notNull().default('0'),
    overageRate: rate('overage_rate').notNull().default('0'),
    renewalDate: d('renewal_date'),
    createdAt: createdAt(),
  },
  (t) => [index('retainer_terms_idx').on(t.retainerId, t.startDate), check('term_valid', sql`${t.monthlyFee} >= 0 and ${t.endDate} >= ${t.startDate}`)],
);

/** Hours used per month; revenue/cost are derived, hours are the only manual input. */
export const retainerPeriods = pgTable(
  'retainer_periods',
  {
    id: pk(),
    retainerId: uuid('retainer_id').notNull().references(() => retainers.id, { onDelete: 'cascade' }),
    month: d('month').notNull(),
    hoursUsed: numeric('hours_used', { precision: 10, scale: 2 }).notNull().default('0'),
    notes: text('notes'),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('retainer_periods_uq').on(t.retainerId, t.month), check('period_nonneg', sql`${t.hoursUsed} >= 0`)],
);

// ───────────────────────────── Deals (pre-project planning) ─────────────────────────────

export const deals = pgTable(
  'deals',
  {
    id: pk(),
    name: text('name').notNull(),
    clientId: uuid('client_id').references(() => clients.id),
    clientName: text('client_name'),
    serviceId: uuid('service_id').references(() => categories.id),
    ownerId: uuid('owner_id').references(() => users.id),
    status: dealStatus('status').notNull().default('OPEN'),
    selectedScenarioId: uuid('selected_scenario_id'),
    notes: text('notes'),
    projectId: uuid('project_id').unique().references(() => projects.id),
    isDemo: boolean('is_demo').notNull().default(false),
    archivedAt: ts('archived_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('deals_status_idx').on(t.status)],
);

export const dealScenarios = pgTable('deal_scenarios', {
  id: pk(),
  dealId: uuid('deal_id').notNull().references(() => deals.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  sellingPrice: money('selling_price').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: createdAt(),
});

export const dealCostLines = pgTable(
  'deal_cost_lines',
  {
    id: pk(),
    scenarioId: uuid('scenario_id').notNull().references(() => dealScenarios.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id').notNull().references(() => categories.id),
    name: text('name').notNull(),
    amount: money('amount').notNull(),
  },
  (t) => [index('deal_cost_lines_scenario_idx').on(t.scenarioId), check('deal_line_nonneg', sql`${t.amount} >= 0`)],
);

// ───────────────────────────── Approvals, notifications, attachments, audit ─────────────────────────────

export const approvals = pgTable(
  'approvals',
  {
    id: pk(),
    type: approvalType('type').notNull(),
    status: approvalStatus('status').notNull().default('PENDING'),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    projectId: uuid('project_id'),
    title: text('title').notNull(),
    reason: text('reason'),
    amount: money('amount'),
    /** operation to apply on approval (e.g. a patch), stored verbatim */
    payload: jsonb('payload'),
    requestedById: uuid('requested_by_id').notNull().references(() => users.id),
    decidedById: uuid('decided_by_id').references(() => users.id),
    decidedAt: ts('decided_at'),
    decisionNote: text('decision_note'),
    createdAt: createdAt(),
  },
  (t) => [index('approvals_status_idx').on(t.status, t.createdAt), index('approvals_entity_idx').on(t.entityType, t.entityId), index('approvals_project_idx').on(t.projectId)],
);

export const notifications = pgTable(
  'notifications',
  {
    id: pk(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    severity: text('severity').notNull().default('info'),
    title: text('title').notNull(),
    body: text('body'),
    link: text('link'),
    /** prevents duplicate notifications for the same condition */
    dedupeKey: text('dedupe_key'),
    readAt: ts('read_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('notifications_dedupe_uq').on(t.userId, t.dedupeKey).where(sql`${t.dedupeKey} is not null`), index('notifications_user_idx').on(t.userId, t.readAt, t.createdAt)],
);

export const attachments = pgTable(
  'attachments',
  {
    id: pk(),
    entityType: attachmentEntity('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    projectId: uuid('project_id'),
    fileName: text('file_name').notNull(),
    storageKey: text('storage_key').notNull().unique(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: text('sha256').notNull(),
    label: text('label'),
    uploadedById: uuid('uploaded_by_id').notNull(),
    archivedAt: ts('archived_at'),
    createdAt: createdAt(),
  },
  (t) => [index('attachments_entity_idx').on(t.entityType, t.entityId), index('attachments_project_idx').on(t.projectId)],
);

/** Append-only. A database trigger (see migrations) blocks UPDATE/DELETE/TRUNCATE. */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    createdAt: createdAt(),
    userId: uuid('user_id'),
    userEmail: text('user_email'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    projectId: uuid('project_id'),
    summary: text('summary'),
    oldValue: jsonb('old_value'),
    newValue: jsonb('new_value'),
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  (t) => [
    index('audit_entity_idx').on(t.entityType, t.entityId),
    index('audit_project_idx').on(t.projectId, t.createdAt),
    index('audit_user_idx').on(t.userId, t.createdAt),
    index('audit_created_idx').on(t.createdAt),
  ],
);

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    key: text('key').primaryKey(),
    userId: uuid('user_id').notNull(),
    route: text('route').notNull(),
    statusCode: integer('status_code').notNull(),
    response: jsonb('response').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('idem_created_idx').on(t.createdAt)],
);

export const importBatches = pgTable(
  'import_batches',
  {
    id: pk(),
    kind: importKind('kind').notNull(),
    fileName: text('file_name').notNull(),
    fileHash: text('file_hash').notNull(),
    status: importStatus('status').notNull().default('VALIDATED'),
    totalRows: integer('total_rows').notNull(),
    validRows: integer('valid_rows').notNull(),
    invalidRows: integer('invalid_rows').notNull(),
    insertedRows: integer('inserted_rows').notNull().default(0),
    skippedRows: integer('skipped_rows').notNull().default(0),
    createdById: uuid('created_by_id').notNull(),
    createdAt: createdAt(),
    committedAt: ts('committed_at'),
  },
  (t) => [index('import_batches_idx').on(t.kind, t.fileHash)],
);
