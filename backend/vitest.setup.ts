// Dummy secrets so that config.ts (which requires them at import time) loads.
// These never reach a real service: the tests exercise pure logic, not I/O.
process.env.DATABASE_URL ??= "postgres://user:pass@127.0.0.1:5432/test";
process.env.MASTER_KEY ??= "test-master-key-at-least-32-chars-long";
process.env.JWT_SECRET ??= "test-jwt-secret-at-least-32-characters-long";
process.env.PASSWORD_PEPPER ??= "test-pepper";
process.env.NODE_ENV ??= "test";
