// Runs in every integration worker before test files load. Points the app at the TEST database only.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://portal:portal_dev_pw@localhost:5432/finance_portal_test';
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.APP_SECRET = 'test-secret-test-secret-test-secret-1234';
process.env.BCRYPT_COST = '4';
process.env.COOKIE_SECURE = 'false';
process.env.APP_ORIGIN = 'http://localhost:3000';
process.env.STORAGE_DIR = './storage-test';
process.env.DB_POOL_MAX = '5';
