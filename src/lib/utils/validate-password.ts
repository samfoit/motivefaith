/**
 * Shared password policy validator.
 *
 * Used by both the signup and reset-password flows to ensure
 * consistent complexity requirements across the app.
 */
export function validatePassword(value: string): string | null {
  if (value.length < 12) return "Password must be at least 12 characters";
  if (!/[a-z]/.test(value)) return "Password must include a lowercase letter";
  if (!/[A-Z]/.test(value)) return "Password must include an uppercase letter";
  if (!/[0-9]/.test(value)) return "Password must include a number";
  return null;
}
