export const TEST_PASSWORD =
  process.env.TEST_USER_PASSWORD ?? "TestPass123!";

export const TEST_EMAIL =
  process.env.TEST_USER_EMAIL ?? "test@example.com";

export function uniqueEmail(prefix = "test") {
  return `${prefix}-${Date.now()}@example.com`;
}

export function uniqueUsername(prefix = "testuser") {
  return `${prefix}${Date.now()}`;
}
