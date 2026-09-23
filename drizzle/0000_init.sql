CREATE TYPE "public"."active_status" AS ENUM('ACTIVE', 'INACTIVE');--> statement-breakpoint
CREATE TYPE "public"."alloc_target_type" AS ENUM('PROJECT', 'DEPARTMENT', 'OVERHEAD');--> statement-breakpoint
CREATE TYPE "public"."allocation_method" AS ENUM('FIXED', 'PERCENT', 'HOURS', 'REVENUE_PERCENT');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."approval_type" AS ENUM('NEW_PROJECT', 'LARGE_EXPENSE', 'BUDGET_INCREASE', 'VENDOR_EXPENSE', 'DISCOUNT', 'PROJECT_CANCELLATION', 'COST_THRESHOLD', 'OVER_BUDGET', 'COST_CHANGE');--> statement-breakpoint
CREATE TYPE "public"."attachment_entity" AS ENUM('PROJECT', 'CLIENT', 'COST', 'EXPENSE', 'INVOICE', 'PAYMENT', 'DEAL');--> statement-breakpoint
CREATE TYPE "public"."billing_frequency" AS ENUM('MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY');--> statement-breakpoint
CREATE TYPE "public"."category_kind" AS ENUM('SERVICE', 'COST', 'EXPENSE');--> statement-breakpoint
CREATE TYPE "public"."cost_kind" AS ENUM('ESTIMATED', 'COMMITTED', 'ACTUAL');--> statement-breakpoint
CREATE TYPE "public"."cost_status" AS ENUM('PLANNED', 'PENDING_APPROVAL', 'APPROVED', 'PAID', 'REJECTED', 'CANCELLED', 'FULFILLED');--> statement-breakpoint
CREATE TYPE "public"."deal_status" AS ENUM('OPEN', 'WON', 'LOST');--> statement-breakpoint
CREATE TYPE "public"."emp_alloc_method" AS ENUM('PERCENT', 'HOURS', 'DAYS', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."expense_scope" AS ENUM('PROJECT', 'COMPANY', 'DEPARTMENT');--> statement-breakpoint
CREATE TYPE "public"."expense_status" AS ENUM('EXPECTED', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'VOID');--> statement-breakpoint
CREATE TYPE "public"."import_kind" AS ENUM('CLIENTS', 'PROJECTS', 'EXPENSES', 'RESOURCES', 'COSTS');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('VALIDATED', 'COMMITTED', 'DISCARDED');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('SCHEDULED', 'ISSUED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."invoice_type" AS ENUM('ADVANCE', 'MILESTONE', 'MONTHLY', 'QUARTERLY', 'FINAL', 'CUSTOM');--> statement-breakpoint
CREATE TYPE "public"."milestone_status" AS ENUM('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED');--> statement-breakpoint
CREATE TYPE "public"."payment_kind" AS ENUM('RECEIPT', 'REFUND');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('BANK_TRANSFER', 'UPI', 'CHEQUE', 'CASH', 'CARD', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."priority" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('LEAD', 'PROPOSAL', 'NEGOTIATION', 'WON', 'ONBOARDING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED', 'LOST');--> statement-breakpoint
CREATE TYPE "public"."project_type" AS ENUM('ONE_TIME', 'RETAINER', 'MILESTONE', 'HOURLY', 'FIXED_RECURRING');--> statement-breakpoint
CREATE TYPE "public"."recurrence" AS ENUM('NONE', 'MONTHLY', 'QUARTERLY', 'YEARLY', 'CUSTOM');--> statement-breakpoint
CREATE TYPE "public"."recurring_frequency" AS ENUM('MONTHLY', 'QUARTERLY', 'YEARLY', 'CUSTOM');--> statement-breakpoint
CREATE TYPE "public"."resource_type" AS ENUM('EMPLOYEE', 'FREELANCER', 'CONTRACTOR', 'AGENCY', 'VENDOR');--> statement-breakpoint
CREATE TYPE "public"."retainer_status" AS ENUM('ACTIVE', 'PAUSED', 'CANCELLED', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."tax_mode" AS ENUM('EXCLUSIVE', 'INCLUSIVE', 'NONE');--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "approval_type" NOT NULL,
	"status" "approval_status" DEFAULT 'PENDING' NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"project_id" uuid,
	"title" text NOT NULL,
	"reason" text,
	"amount" numeric(16, 2),
	"payload" jsonb,
	"requested_by_id" uuid NOT NULL,
	"decided_by_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" "attachment_entity" NOT NULL,
	"entity_id" uuid NOT NULL,
	"project_id" uuid,
	"file_name" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"label" text,
	"uploaded_by_id" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attachments_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	"user_email" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"project_id" uuid,
	"summary" text,
	"old_value" jsonb,
	"new_value" jsonb,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "category_kind" NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_name" text NOT NULL,
	"contact_person" text,
	"email" text,
	"phone" text,
	"website" text,
	"industry" text,
	"address" text,
	"gstin" varchar(15),
	"state_code" varchar(2),
	"country" text DEFAULT 'India' NOT NULL,
	"currency" varchar(3) DEFAULT 'INR' NOT NULL,
	"notes" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"gstin" varchar(15),
	"pan" varchar(10),
	"state_code" varchar(2),
	"address" text,
	"email" text,
	"phone" text,
	"base_currency" varchar(3) DEFAULT 'INR' NOT NULL,
	"fy_start_month" integer DEFAULT 4 NOT NULL,
	"date_format" text DEFAULT 'DD/MM/YYYY' NOT NULL,
	"number_format" text DEFAULT 'en-IN' NOT NULL,
	"setup_complete" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deal_cost_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scenario_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"name" text NOT NULL,
	"amount" numeric(16, 2) NOT NULL,
	CONSTRAINT "deal_line_nonneg" CHECK ("deal_cost_lines"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "deal_scenarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"name" text NOT NULL,
	"selling_price" numeric(16, 2) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"client_id" uuid,
	"client_name" text,
	"service_id" uuid,
	"owner_id" uuid,
	"status" "deal_status" DEFAULT 'OPEN' NOT NULL,
	"selected_scenario_id" uuid,
	"notes" text,
	"project_id" uuid,
	"is_demo" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deals_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE "employee_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_id" uuid NOT NULL,
	"project_id" uuid,
	"project_key" text NOT NULL,
	"month" date NOT NULL,
	"method" "emp_alloc_method" NOT NULL,
	"value" numeric(12, 4) NOT NULL,
	"monthly_cost_snapshot" numeric(16, 2) NOT NULL,
	"amount" numeric(16, 2) NOT NULL,
	"notes" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "emp_alloc_nonneg" CHECK ("employee_allocations"."amount" >= 0 and "employee_allocations"."value" >= 0 and "employee_allocations"."monthly_cost_snapshot" >= 0)
);
--> statement-breakpoint
CREATE TABLE "exchange_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"currency" varchar(3) NOT NULL,
	"rate_to_base" numeric(18, 8) NOT NULL,
	"effective_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exchange_rate_positive" CHECK ("exchange_rates"."rate_to_base" > 0)
);
--> statement-breakpoint
CREATE TABLE "expense_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expense_id" uuid NOT NULL,
	"target_type" "alloc_target_type" NOT NULL,
	"project_id" uuid,
	"department" text,
	"method" "allocation_method" NOT NULL,
	"value" numeric(16, 4) DEFAULT '0' NOT NULL,
	"amount" numeric(16, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ea_amount_nonneg" CHECK ("expense_allocations"."amount" >= 0 and "expense_allocations"."value" >= 0)
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"category_id" uuid NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(16, 2) NOT NULL,
	"tax_amount" numeric(16, 2) DEFAULT '0' NOT NULL,
	"original_amount" numeric(16, 2) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"fx_rate" numeric(18, 8) DEFAULT '1' NOT NULL,
	"vendor_id" uuid,
	"payment_method" "payment_method" DEFAULT 'BANK_TRANSFER' NOT NULL,
	"scope" "expense_scope" DEFAULT 'COMPANY' NOT NULL,
	"project_id" uuid,
	"department" text,
	"status" "expense_status" DEFAULT 'APPROVED' NOT NULL,
	"recurring_rule_id" uuid,
	"period_start" date,
	"reference" text,
	"notes" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_amount_valid" CHECK ("expenses"."amount" > 0 and "expenses"."tax_amount" >= 0),
	CONSTRAINT "expense_scope_project" CHECK (("expenses"."scope" <> 'PROJECT') or ("expenses"."project_id" is not null)),
	CONSTRAINT "expense_fx_positive" CHECK ("expenses"."fx_rate" > 0)
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"key" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"route" text NOT NULL,
	"status_code" integer NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "import_kind" NOT NULL,
	"file_name" text NOT NULL,
	"file_hash" text NOT NULL,
	"status" "import_status" DEFAULT 'VALIDATED' NOT NULL,
	"total_rows" integer NOT NULL,
	"valid_rows" integer NOT NULL,
	"invalid_rows" integer NOT NULL,
	"inserted_rows" integer DEFAULT 0 NOT NULL,
	"skipped_rows" integer DEFAULT 0 NOT NULL,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"committed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"number" text NOT NULL,
	"type" "invoice_type" DEFAULT 'CUSTOM' NOT NULL,
	"milestone_id" uuid,
	"description" text,
	"status" "invoice_status" DEFAULT 'ISSUED' NOT NULL,
	"issue_date" date,
	"due_date" date NOT NULL,
	"subtotal" numeric(16, 2) NOT NULL,
	"cgst" numeric(16, 2) DEFAULT '0' NOT NULL,
	"sgst" numeric(16, 2) DEFAULT '0' NOT NULL,
	"igst" numeric(16, 2) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(16, 2) DEFAULT '0' NOT NULL,
	"total" numeric(16, 2) NOT NULL,
	"period_start" date,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_number_unique" UNIQUE("number"),
	CONSTRAINT "invoice_amounts_valid" CHECK ("invoices"."subtotal" >= 0 and "invoices"."tax_amount" >= 0 and "invoices"."total" >= 0)
);
--> statement-breakpoint
CREATE TABLE "milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price" numeric(16, 2) DEFAULT '0' NOT NULL,
	"cost" numeric(16, 2) DEFAULT '0' NOT NULL,
	"start_date" date,
	"due_date" date,
	"status" "milestone_status" DEFAULT 'NOT_STARTED' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "milestone_nonneg" CHECK ("milestones"."price" >= 0 and "milestones"."cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"dedupe_key" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"days" integer NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "payment_terms_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"invoice_id" uuid,
	"kind" "payment_kind" DEFAULT 'RECEIPT' NOT NULL,
	"amount" numeric(16, 2) NOT NULL,
	"tds_amount" numeric(16, 2) DEFAULT '0' NOT NULL,
	"received_date" date NOT NULL,
	"method" "payment_method" DEFAULT 'BANK_TRANSFER' NOT NULL,
	"reference" text,
	"notes" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_amount_valid" CHECK ("payments"."amount" > 0 and "payments"."tds_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"group" text NOT NULL,
	"description" text NOT NULL,
	CONSTRAINT "permissions_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "project_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"amount" numeric(16, 2) NOT NULL,
	"reason" text NOT NULL,
	"date" date NOT NULL,
	"created_by_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "adj_nonzero" CHECK ("project_adjustments"."amount" <> 0)
);
--> statement-breakpoint
CREATE TABLE "project_budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"amount" numeric(16, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_budget_nonneg" CHECK ("project_budgets"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "project_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category_id" uuid NOT NULL,
	"description" text,
	"kind" "cost_kind" DEFAULT 'ACTUAL' NOT NULL,
	"status" "cost_status" DEFAULT 'APPROVED' NOT NULL,
	"amount" numeric(16, 2) NOT NULL,
	"original_amount" numeric(16, 2) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"fx_rate" numeric(18, 8) DEFAULT '1' NOT NULL,
	"is_credit" boolean DEFAULT false NOT NULL,
	"date" date NOT NULL,
	"vendor_id" uuid,
	"resource_id" uuid,
	"recurrence" "recurrence" DEFAULT 'NONE' NOT NULL,
	"recurrence_interval_months" integer,
	"recurrence_ends" date,
	"notes" text,
	"expense_id" uuid,
	"override_reason" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cost_amount_valid" CHECK (("project_costs"."is_credit" and "project_costs"."amount" < 0) or (not "project_costs"."is_credit" and "project_costs"."amount" > 0)),
	CONSTRAINT "cost_fx_positive" CHECK ("project_costs"."fx_rate" > 0)
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_members_project_id_user_id_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "project_resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"planned_hours" numeric(10, 2) DEFAULT '0' NOT NULL,
	"actual_hours" numeric(10, 2) DEFAULT '0' NOT NULL,
	"cost_rate" numeric(12, 2) NOT NULL,
	"billing_rate" numeric(12, 2) DEFAULT '0' NOT NULL,
	"paid_amount" numeric(16, 2) DEFAULT '0' NOT NULL,
	"start_date" date,
	"end_date" date,
	"notes" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pr_nonneg" CHECK ("project_resources"."planned_hours" >= 0 and "project_resources"."actual_hours" >= 0 and "project_resources"."cost_rate" >= 0 and "project_resources"."billing_rate" >= 0 and "project_resources"."paid_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"client_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"type" "project_type" NOT NULL,
	"description" text,
	"manager_id" uuid,
	"sales_owner_id" uuid,
	"start_date" date,
	"end_date" date,
	"contract_date" date,
	"priority" "priority" DEFAULT 'MEDIUM' NOT NULL,
	"status" "project_status" DEFAULT 'LEAD' NOT NULL,
	"currency" varchar(3) DEFAULT 'INR' NOT NULL,
	"fx_rate_to_base" numeric(18, 8) DEFAULT '1' NOT NULL,
	"tax_mode" "tax_mode" DEFAULT 'EXCLUSIVE' NOT NULL,
	"tax_rate_pct" numeric(6, 3) DEFAULT '18' NOT NULL,
	"selling_price" numeric(16, 2) DEFAULT '0' NOT NULL,
	"discount" numeric(16, 2) DEFAULT '0' NOT NULL,
	"setup_fee" numeric(16, 2) DEFAULT '0' NOT NULL,
	"monthly_fee" numeric(16, 2) DEFAULT '0' NOT NULL,
	"duration_months" integer DEFAULT 0 NOT NULL,
	"payment_terms" text,
	"notes" text,
	"budget" numeric(16, 2) DEFAULT '0' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_code_unique" UNIQUE("code"),
	CONSTRAINT "project_money_nonneg" CHECK ("projects"."discount" >= 0 and "projects"."budget" >= 0 and "projects"."setup_fee" >= 0 and "projects"."monthly_fee" >= 0),
	CONSTRAINT "project_selling_price_nonneg" CHECK ("projects"."selling_price" >= 0),
	CONSTRAINT "project_dates_order" CHECK ("projects"."end_date" is null or "projects"."start_date" is null or "projects"."end_date" >= "projects"."start_date"),
	CONSTRAINT "project_fx_positive" CHECK ("projects"."fx_rate_to_base" > 0),
	CONSTRAINT "project_tax_range" CHECK ("projects"."tax_rate_pct" >= 0 and "projects"."tax_rate_pct" <= 100)
);
--> statement-breakpoint
CREATE TABLE "recurring_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category_id" uuid NOT NULL,
	"vendor_id" uuid,
	"project_id" uuid,
	"department" text,
	"scope" "expense_scope" DEFAULT 'COMPANY' NOT NULL,
	"amount" numeric(16, 2) NOT NULL,
	"tax_amount" numeric(16, 2) DEFAULT '0' NOT NULL,
	"frequency" "recurring_frequency" NOT NULL,
	"interval_months" integer DEFAULT 1 NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"active" boolean DEFAULT true NOT NULL,
	"last_generated_through" date,
	"notes" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rule_valid" CHECK ("recurring_rules"."amount" > 0 and "recurring_rules"."interval_months" >= 1)
);
--> statement-breakpoint
CREATE TABLE "resource_rate_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_id" uuid NOT NULL,
	"effective_on" date NOT NULL,
	"hourly_cost" numeric(12, 2) NOT NULL,
	"daily_cost" numeric(12, 2) NOT NULL,
	"monthly_cost" numeric(12, 2) NOT NULL,
	"billing_rate" numeric(12, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"type" "resource_type" NOT NULL,
	"hourly_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"daily_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"monthly_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"billing_rate" numeric(12, 2) DEFAULT '0' NOT NULL,
	"email" text,
	"phone" text,
	"department" text,
	"status" "active_status" DEFAULT 'ACTIVE' NOT NULL,
	"start_date" date,
	"end_date" date,
	"user_id" uuid,
	"notes" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_rates_nonneg" CHECK ("resources"."hourly_cost" >= 0 and "resources"."daily_cost" >= 0 and "resources"."monthly_cost" >= 0 and "resources"."billing_rate" >= 0)
);
--> statement-breakpoint
CREATE TABLE "retainer_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"retainer_id" uuid NOT NULL,
	"month" date NOT NULL,
	"hours_used" numeric(10, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "period_nonneg" CHECK ("retainer_periods"."hours_used" >= 0)
);
--> statement-breakpoint
CREATE TABLE "retainer_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"retainer_id" uuid NOT NULL,
	"monthly_fee" numeric(16, 2) NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"included_hours" numeric(10, 2) DEFAULT '0' NOT NULL,
	"overage_rate" numeric(12, 2) DEFAULT '0' NOT NULL,
	"renewal_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "term_valid" CHECK ("retainer_terms"."monthly_fee" >= 0 and "retainer_terms"."end_date" >= "retainer_terms"."start_date")
);
--> statement-breakpoint
CREATE TABLE "retainers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"account_manager_id" uuid,
	"billing_frequency" "billing_frequency" DEFAULT 'MONTHLY' NOT NULL,
	"status" "retainer_status" DEFAULT 'ACTIVE' NOT NULL,
	"cancelled_on" date,
	"notes" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retainers_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_id_pk" PRIMARY KEY("role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"csrf_token" text NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "tax_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"rate_pct" numeric(6, 3) NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_rates_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"must_change_pw" boolean DEFAULT false NOT NULL,
	"notify_prefs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"contact_name" text,
	"email" text,
	"phone" text,
	"gstin" varchar(15),
	"category" text,
	"notes" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_cost_lines" ADD CONSTRAINT "deal_cost_lines_scenario_id_deal_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."deal_scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_cost_lines" ADD CONSTRAINT "deal_cost_lines_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_scenarios" ADD CONSTRAINT "deal_scenarios_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_service_id_categories_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_allocations" ADD CONSTRAINT "employee_allocations_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_allocations" ADD CONSTRAINT "employee_allocations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_allocations" ADD CONSTRAINT "expense_allocations_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_allocations" ADD CONSTRAINT "expense_allocations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_recurring_rule_id_recurring_rules_id_fk" FOREIGN KEY ("recurring_rule_id") REFERENCES "public"."recurring_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_adjustments" ADD CONSTRAINT "project_adjustments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_budgets" ADD CONSTRAINT "project_budgets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_budgets" ADD CONSTRAINT "project_budgets_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_costs" ADD CONSTRAINT "project_costs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_costs" ADD CONSTRAINT "project_costs_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_costs" ADD CONSTRAINT "project_costs_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_costs" ADD CONSTRAINT "project_costs_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_costs" ADD CONSTRAINT "project_costs_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_resources" ADD CONSTRAINT "project_resources_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_resources" ADD CONSTRAINT "project_resources_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_service_id_categories_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_sales_owner_id_users_id_fk" FOREIGN KEY ("sales_owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_rate_history" ADD CONSTRAINT "resource_rate_history_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retainer_periods" ADD CONSTRAINT "retainer_periods_retainer_id_retainers_id_fk" FOREIGN KEY ("retainer_id") REFERENCES "public"."retainers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retainer_terms" ADD CONSTRAINT "retainer_terms_retainer_id_retainers_id_fk" FOREIGN KEY ("retainer_id") REFERENCES "public"."retainers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retainers" ADD CONSTRAINT "retainers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retainers" ADD CONSTRAINT "retainers_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retainers" ADD CONSTRAINT "retainers_service_id_categories_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retainers" ADD CONSTRAINT "retainers_account_manager_id_users_id_fk" FOREIGN KEY ("account_manager_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approvals_status_idx" ON "approvals" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "approvals_entity_idx" ON "approvals" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "approvals_project_idx" ON "approvals" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "attachments_entity_idx" ON "attachments" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "attachments_project_idx" ON "attachments" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_project_idx" ON "audit_logs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_user_idx" ON "audit_logs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_kind_slug_uq" ON "categories" USING btree ("kind","slug");--> statement-breakpoint
CREATE INDEX "categories_kind_active_idx" ON "categories" USING btree ("kind","active","sort_order");--> statement-breakpoint
CREATE INDEX "clients_name_idx" ON "clients" USING btree ("company_name");--> statement-breakpoint
CREATE INDEX "clients_archived_idx" ON "clients" USING btree ("archived_at");--> statement-breakpoint
CREATE UNIQUE INDEX "clients_name_active_uq" ON "clients" USING btree (lower("company_name")) WHERE "clients"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "deal_cost_lines_scenario_idx" ON "deal_cost_lines" USING btree ("scenario_id");--> statement-breakpoint
CREATE INDEX "deals_status_idx" ON "deals" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "emp_alloc_uq" ON "employee_allocations" USING btree ("resource_id","month","project_key");--> statement-breakpoint
CREATE INDEX "emp_alloc_project_idx" ON "employee_allocations" USING btree ("project_id","month");--> statement-breakpoint
CREATE INDEX "emp_alloc_month_idx" ON "employee_allocations" USING btree ("month");--> statement-breakpoint
CREATE UNIQUE INDEX "exchange_rates_currency_effective_uq" ON "exchange_rates" USING btree ("currency","effective_on");--> statement-breakpoint
CREATE INDEX "ea_expense_idx" ON "expense_allocations" USING btree ("expense_id");--> statement-breakpoint
CREATE INDEX "ea_project_idx" ON "expense_allocations" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_rule_period_uq" ON "expenses" USING btree ("recurring_rule_id","period_start") WHERE "expenses"."recurring_rule_id" is not null;--> statement-breakpoint
CREATE INDEX "expenses_date_idx" ON "expenses" USING btree ("date","status","archived_at");--> statement-breakpoint
CREATE INDEX "expenses_category_idx" ON "expenses" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "expenses_project_idx" ON "expenses" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "expenses_scope_idx" ON "expenses" USING btree ("scope");--> statement-breakpoint
CREATE INDEX "expenses_vendor_idx" ON "expenses" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "idem_created_idx" ON "idempotency_keys" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "import_batches_idx" ON "import_batches" USING btree ("kind","file_hash");--> statement-breakpoint
CREATE INDEX "invoices_project_status_idx" ON "invoices" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "invoices_due_idx" ON "invoices" USING btree ("due_date","status");--> statement-breakpoint
CREATE INDEX "invoices_issue_idx" ON "invoices" USING btree ("issue_date");--> statement-breakpoint
CREATE INDEX "milestones_project_idx" ON "milestones" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_uq" ON "notifications" USING btree ("user_id","dedupe_key") WHERE "notifications"."dedupe_key" is not null;--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","read_at","created_at");--> statement-breakpoint
CREATE INDEX "payments_project_idx" ON "payments" USING btree ("project_id","voided_at");--> statement-breakpoint
CREATE INDEX "payments_invoice_idx" ON "payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "payments_received_idx" ON "payments" USING btree ("received_date");--> statement-breakpoint
CREATE INDEX "adj_project_idx" ON "project_adjustments" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_budgets_uq" ON "project_budgets" USING btree ("project_id","category_id");--> statement-breakpoint
CREATE INDEX "costs_project_kind_idx" ON "project_costs" USING btree ("project_id","kind","status","archived_at");--> statement-breakpoint
CREATE INDEX "costs_project_date_idx" ON "project_costs" USING btree ("project_id","date");--> statement-breakpoint
CREATE INDEX "costs_category_idx" ON "project_costs" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "costs_date_idx" ON "project_costs" USING btree ("date");--> statement-breakpoint
CREATE INDEX "costs_vendor_idx" ON "project_costs" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "costs_resource_idx" ON "project_costs" USING btree ("resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "costs_expense_uq" ON "project_costs" USING btree ("expense_id") WHERE "project_costs"."expense_id" is not null;--> statement-breakpoint
CREATE INDEX "project_members_user_idx" ON "project_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "pr_project_idx" ON "project_resources" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "pr_resource_idx" ON "project_resources" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "projects_client_idx" ON "projects" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "projects_service_idx" ON "projects" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "projects_manager_idx" ON "projects" USING btree ("manager_id");--> statement-breakpoint
CREATE INDEX "projects_status_idx" ON "projects" USING btree ("status","archived_at");--> statement-breakpoint
CREATE INDEX "projects_type_idx" ON "projects" USING btree ("type");--> statement-breakpoint
CREATE INDEX "projects_start_idx" ON "projects" USING btree ("start_date");--> statement-breakpoint
CREATE INDEX "projects_created_idx" ON "projects" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "projects_name_idx" ON "projects" USING btree ("name");--> statement-breakpoint
CREATE INDEX "rate_hist_resource_idx" ON "resource_rate_history" USING btree ("resource_id","effective_on");--> statement-breakpoint
CREATE INDEX "resources_type_status_idx" ON "resources" USING btree ("type","status");--> statement-breakpoint
CREATE INDEX "resources_name_idx" ON "resources" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "retainer_periods_uq" ON "retainer_periods" USING btree ("retainer_id","month");--> statement-breakpoint
CREATE INDEX "retainer_terms_idx" ON "retainer_terms" USING btree ("retainer_id","start_date");--> statement-breakpoint
CREATE INDEX "retainers_status_idx" ON "retainers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "vendors_name_idx" ON "vendors" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "vendors_name_active_uq" ON "vendors" USING btree (lower("name")) WHERE "vendors"."archived_at" is null;