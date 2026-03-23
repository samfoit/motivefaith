/**
 * Check if a password appears in known data breaches using the
 * HaveIBeenPwned k-anonymity API (Pwned Passwords v3).
 *
 * Only the first 5 characters of the SHA-1 hash are sent to the API,
 * so the full password is never transmitted.
 *
 * Returns `true` if the password is breached, `false` if clean.
 * Returns `false` on network errors to avoid blocking sign-up.
 */
export async function isPasswordBreached(password: string): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest("SHA-1", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();

    const prefix = hashHex.slice(0, 5);
    const suffix = hashHex.slice(5);

    const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true" },
    });

    if (!response.ok) return false;

    const text = await response.text();
    const lines = text.split("\n");

    for (const line of lines) {
      const [hashSuffix, count] = line.split(":");
      if (hashSuffix.trim() === suffix && parseInt(count.trim(), 10) > 0) {
        return true;
      }
    }

    return false;
  } catch (err) {
    // Network failure — don't block the user
    console.warn("Breached-password check failed (network):", err);
    return false;
  }
}
