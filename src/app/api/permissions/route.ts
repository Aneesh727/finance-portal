import { route } from '@/lib/api';
import { PERMISSIONS } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

export const GET = route({ anyPerm: ['roles.manage', 'users.manage'] }, async () => {
  const groups: Record<string, { key: string; description: string }[]> = {};
  for (const [g, key, description] of PERMISSIONS) (groups[g] ??= []).push({ key, description });
  return Object.entries(groups).map(([group, items]) => ({ group, items }));
});
