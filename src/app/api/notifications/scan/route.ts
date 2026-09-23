import { route } from '@/lib/api';
import { db } from '@/lib/db';
import { runNotificationScan } from '@/lib/services/alerts';

export const dynamic = 'force-dynamic';

/** run the alert scan now (also run daily by scripts/daily-jobs.ts) */
export const POST = route({ anyPerm: ['settings.manage', 'approvals.decide'] }, async () => db.transaction((tx) => runNotificationScan(tx)));
