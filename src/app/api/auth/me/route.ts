import { route } from '@/lib/api';
import { getCompany } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export const GET = route({ allowMustChangePw: true }, async ({ user }) => {
  const c = await getCompany();
  return {
    user: { id: user.id, email: user.email, name: user.name, role: { key: user.roleKey, name: user.roleName }, mustChangePw: user.mustChangePw },
    permissions: [...user.perms].sort(),
    csrfToken: user.csrfToken,
    company: c
      ? { name: c.name, baseCurrency: c.baseCurrency, fyStartMonth: c.fyStartMonth, dateFormat: c.dateFormat, numberFormat: c.numberFormat, stateCode: c.stateCode, setupComplete: c.setupComplete }
      : null,
  };
});
