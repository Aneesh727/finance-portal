import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  APP_ORIGIN: z.string().url().default('http://localhost:3000'),
  COOKIE_SECURE: z.string().optional(),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(12),
  APP_SECRET: z.string().min(32, 'APP_SECRET must be at least 32 characters'),
  BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(12),
  STORAGE_DIR: z.string().default('./storage'),
  MAX_UPLOAD_MB: z.coerce.number().min(1).max(100).default(10),
  APP_TIMEZONE: z.string().default('Asia/Kolkata'),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(200).default(10),
  /** set to "true" only when running behind a trusted reverse proxy that sets X-Forwarded-For */
  TRUST_PROXY: z.string().optional(),
});

export type Env = z.infer<typeof schema> & { cookieSecure: boolean };
let cached: Env | null = null;

/** Validated environment. Throws a readable error on misconfiguration (fails fast in production). */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${msg}`);
  }
  const e = parsed.data;
  if (e.NODE_ENV === 'production' && /change_?me|dev-only/i.test(e.APP_SECRET)) {
    throw new Error('APP_SECRET must be changed from the example value in production');
  }
  cached = { ...e, cookieSecure: e.COOKIE_SECURE ? e.COOKIE_SECURE === 'true' : e.NODE_ENV === 'production' };
  return cached;
}

export function resetEnvCache() {
  cached = null;
}
