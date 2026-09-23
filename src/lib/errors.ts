export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const badRequest = (message: string, details?: unknown, code = 'BAD_REQUEST') => new ApiError(400, code, message, details);
export const unauthorized = (message = 'Please sign in to continue.', code = 'UNAUTHENTICATED') => new ApiError(401, code, message);
export const forbidden = (message = 'You do not have permission to do this.', code = 'FORBIDDEN') => new ApiError(403, code, message);
export const notFound = (what = 'Record') => new ApiError(404, 'NOT_FOUND', `${what} not found.`);
export const conflict = (message: string, code = 'CONFLICT', details?: unknown) => new ApiError(409, code, message, details);
export const unprocessable = (message: string, details?: unknown, code = 'VALIDATION_FAILED') => new ApiError(422, code, message, details);
export const tooMany = (retryAfterSec: number) => new ApiError(429, 'RATE_LIMITED', `Too many requests. Try again in ${retryAfterSec}s.`, { retryAfterSec });

/** Translate low-level database errors into useful, non-leaky messages. */
export function mapDbError(e: unknown): ApiError | null {
  const err = e as { code?: string; constraint?: string; detail?: string; cause?: { code?: string; constraint?: string; detail?: string } };
  const src = err?.code ? err : err?.cause;
  const code = src?.code;
  if (!code) return null;
  const constraint = src?.constraint ?? '';
  switch (code) {
    case '23505':
      return conflict(friendlyUnique(constraint), 'DUPLICATE', { constraint });
    case '23503':
      return conflict('This record is linked to other data (or references something that does not exist).', 'REFERENCE_ERROR', { constraint });
    case '23514':
      return unprocessable(friendlyCheck(constraint), { constraint }, 'CONSTRAINT_VIOLATION');
    case '23502':
      return unprocessable('A required field is missing.', { constraint }, 'MISSING_FIELD');
    case '22P02':
    case '22007':
    case '22008':
      return badRequest('One of the values has an invalid format.', undefined, 'INVALID_FORMAT');
    case '22003':
      return badRequest('A number is too large.', undefined, 'NUMBER_TOO_LARGE');
    case '40001':
    case '40P01':
      return conflict('The data was changed by someone else at the same moment. Please retry.', 'SERIALIZATION_CONFLICT');
    case '57014':
      return new ApiError(503, 'TIMEOUT', 'The request took too long. Try narrowing your filters.');
    case '42501':
      return forbidden('This record is protected and cannot be modified.', 'PROTECTED_RECORD');
    default:
      return null;
  }
}

function friendlyUnique(c: string): string {
  if (c.includes('clients_name')) return 'A client with this name already exists.';
  if (c.includes('vendors_name')) return 'A vendor with this name already exists.';
  if (c.includes('expenses_rule_period')) return 'This recurring expense was already generated for that period.';
  if (c.includes('projects_code')) return 'A project with this code already exists.';
  if (c.includes('users_email')) return 'A user with this email already exists.';
  if (c.includes('categories_kind_slug')) return 'A category with this name already exists.';
  if (c.includes('invoices_number')) return 'An invoice with this number already exists.';
  if (c.includes('emp_alloc')) return 'This employee is already allocated to that project for the month. Edit the existing allocation.';
  if (c.includes('project_budgets')) return 'A budget for this category already exists on the project.';
  return 'A record with the same unique value already exists.';
}

function friendlyCheck(c: string): string {
  const map: Record<string, string> = {
    expense_amount_valid: 'Expense amount must be greater than zero.',
    payment_amount_valid: 'Payment amount must be greater than zero.',
    cost_amount_valid: 'Cost amount must be greater than zero (credits must be negative and flagged as credit).',
    project_dates_order: 'The end date cannot be before the start date.',
    project_money_nonneg: 'Amounts on a project cannot be negative.',
    project_selling_price_nonneg: 'Selling price cannot be negative.',
    expense_scope_project: 'A project-specific expense needs a project.',
    ea_amount_nonneg: 'Allocation amounts cannot be negative.',
    emp_alloc_nonneg: 'Allocation amounts cannot be negative.',
  };
  return map[c] ?? 'The values violate a data rule (for example a negative amount or an invalid date range).';
}

export function errorPayload(e: ApiError, requestId: string) {
  return { error: { code: e.code, message: e.message, details: e.details, requestId } };
}
