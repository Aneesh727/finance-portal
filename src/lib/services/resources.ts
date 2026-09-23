import type { AuthUser } from '@/lib/auth';
import { mulDiv, fromMinor, toMinor } from '@/lib/money';
import type { AppSettings } from '@/lib/settings';

export const canSeeRates = (u: AuthUser) => u.perms.has('resources.manage') || u.perms.has('profit.view');

/** hide sensitive pay/billing rates unless the caller may see them */
export function redactResource<T extends Record<string, unknown>>(r: T, u: AuthUser): T {
  if (canSeeRates(u)) return r;
  const { hourlyCost, dailyCost, monthlyCost, billingRate, ...rest } = r as Record<string, unknown>;
  void hourlyCost; void dailyCost; void monthlyCost; void billingRate;
  return rest as T;
}

/** For employees, fill missing hourly/daily cost from the monthly salary using the configured working hours/days. */
export function deriveRates(input: { type: string; hourlyCost: string; dailyCost: string; monthlyCost: string }, s: AppSettings) {
  let { hourlyCost, dailyCost } = input;
  const monthlyMinor = toMinor(input.monthlyCost);
  if (input.type === 'EMPLOYEE' && monthlyMinor > 0) {
    if (toMinor(hourlyCost) === 0) hourlyCost = fromMinor(mulDiv(monthlyMinor, 10000, Math.round(s.allocation.workHoursPerMonth * 10000)));
    if (toMinor(dailyCost) === 0) dailyCost = fromMinor(mulDiv(monthlyMinor, 10000, Math.round(s.allocation.workDaysPerMonth * 10000)));
  }
  return { hourlyCost, dailyCost };
}
