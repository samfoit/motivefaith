import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PushPayload {
  /** The push subscription JSON (from PushManager.subscribe().toJSON()) */
  subscription: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  };
  /** Notification title */
  title: string;
  /** Notification body text */
  body: string;
  /** URL to open on click */
  url?: string;
  /** Notification category */
  type?: "completion" | "missed_habit" | "encouragement";
  /** User ID that owns this subscription — used to scope cleanup */
  user_id?: string;
}

// ---------------------------------------------------------------------------
// Web Push helpers (RFC 8291 via Web Push Protocol)
// ---------------------------------------------------------------------------

async function sendWebPush(
  subscription: PushPayload["subscription"],
  payload: string,
  vapidPrivateKey: string,
  vapidPublicKey: string,
  vapidSubject: string,
): Promise<boolean> {
  // Import the VAPID keys
  const privateKeyBytes = base64UrlToUint8Array(vapidPrivateKey);
  const publicKeyBytes = base64UrlToUint8Array(vapidPublicKey);

  // Create ECDSA signing key for VAPID
  const signingKey = await crypto.subtle.importKey(
    "pkcs8",
    convertECPrivateKey(privateKeyBytes, publicKeyBytes),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );

  // Create ECDH key for content encryption
  const localKeyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );

  // Import subscriber's public key
  const subscriberPublicKey = await crypto.subtle.importKey(
    "raw",
    base64UrlToUint8Array(subscription.keys.p256dh),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );

  // Derive shared secret
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: "ECDH", public: subscriberPublicKey },
    localKeyPair.privateKey,
    256,
  );

  // Export local public key
  const localPublicKeyRaw = await crypto.subtle.exportKey(
    "raw",
    localKeyPair.publicKey,
  );

  const authSecret = base64UrlToUint8Array(subscription.keys.auth);

  // Derive encryption keys (RFC 8291)
  const ikm = await deriveIKM(
    sharedSecret,
    authSecret,
    subscription.keys.p256dh,
    localPublicKeyRaw,
  );
  const { contentKey, nonce, salt } = await deriveContentKey(ikm);

  // Encrypt the payload
  const payloadBytes = new TextEncoder().encode(payload);
  const paddedPayload = addPadding(payloadBytes);

  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    contentKey,
    paddedPayload,
  );

  // Build the aes128gcm body per RFC 8188 Section 2:
  // salt (16) | record_size (4) | keyid_length (1) | keyid (65) | ciphertext
  const encryptedBytes = new Uint8Array(encrypted);
  const body = new Uint8Array(16 + 5 + 65 + encryptedBytes.byteLength);
  const view = new DataView(body.buffer);
  body.set(salt, 0);                                    // salt at offset 0
  view.setUint32(16, 4096, false);                       // record_size at offset 16
  view.setUint8(20, 65);                                 // keyid_length at offset 20
  body.set(new Uint8Array(localPublicKeyRaw), 21);       // keyid at offset 21
  body.set(encryptedBytes, 86);                          // ciphertext at offset 86

  // Create VAPID JWT
  const jwt = await createVapidJwt(
    subscription.endpoint,
    signingKey,
    vapidPublicKey,
    vapidSubject,
  );

  // Send the push
  const res = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      TTL: "86400",
      Authorization: `vapid t=${jwt}, k=${vapidPublicKey}`,
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`Push failed (${res.status}): ${text}`);
    return false;
  }

  return true;
}

// --- Crypto helpers ---

function base64UrlToUint8Array(b64url: string): Uint8Array {
  const padding = "=".repeat((4 - (b64url.length % 4)) % 4);
  const b64 = (b64url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

function uint8ArrayToBase64Url(arr: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function convertECPrivateKey(
  privateKeyRaw: Uint8Array,
  publicKeyRaw: Uint8Array,
): ArrayBuffer {
  // Wrap raw 32-byte private key + 65-byte public key in PKCS#8 DER for P-256
  const pkcs8Header = new Uint8Array([
    0x30, 0x81, 0x87, 0x02, 0x01, 0x00, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86,
    0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d,
    0x03, 0x01, 0x07, 0x04, 0x6d, 0x30, 0x6b, 0x02, 0x01, 0x01, 0x04, 0x20,
  ]);
  const publicKeyPrefix = new Uint8Array([0xa1, 0x44, 0x03, 0x42, 0x00]);
  const result = new Uint8Array(
    pkcs8Header.length +
      privateKeyRaw.length +
      publicKeyPrefix.length +
      publicKeyRaw.length,
  );
  result.set(pkcs8Header, 0);
  result.set(privateKeyRaw, pkcs8Header.length);
  result.set(publicKeyPrefix, pkcs8Header.length + privateKeyRaw.length);
  result.set(
    publicKeyRaw,
    pkcs8Header.length + privateKeyRaw.length + publicKeyPrefix.length,
  );
  return result.buffer;
}

async function deriveIKM(
  sharedSecret: ArrayBuffer,
  authSecret: Uint8Array,
  subscriberPublicKeyB64: string,
  localPublicKeyRaw: ArrayBuffer,
): Promise<ArrayBuffer> {
  const subscriberKey = base64UrlToUint8Array(subscriberPublicKeyB64);

  // PRK = HKDF-Extract(auth_secret, shared_secret)
  const prk = await hkdfExtract(authSecret, new Uint8Array(sharedSecret));

  // Build info: "WebPush: info\0" + subscriber_pub_key (65) + local_pub_key (65)
  const info = new Uint8Array(
    new TextEncoder().encode("WebPush: info\0").length +
      subscriberKey.length +
      new Uint8Array(localPublicKeyRaw).length,
  );
  const infoLabel = new TextEncoder().encode("WebPush: info\0");
  info.set(infoLabel, 0);
  info.set(subscriberKey, infoLabel.length);
  info.set(
    new Uint8Array(localPublicKeyRaw),
    infoLabel.length + subscriberKey.length,
  );

  // IKM = HKDF-Expand(PRK, info, 32)
  return hkdfExpand(prk, info, 32);
}

async function deriveContentKey(
  ikm: ArrayBuffer,
): Promise<{ contentKey: CryptoKey; nonce: Uint8Array; salt: Uint8Array }> {
  // Salt for content encryption (16 random bytes)
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // PRK = HKDF-Extract(salt, IKM)
  const prk = await hkdfExtract(salt, new Uint8Array(ikm));

  // Content encryption key
  const cekInfo = new TextEncoder().encode("Content-Encoding: aes128gcm\0");
  const cekBytes = await hkdfExpand(prk, cekInfo, 16);
  const contentKey = await crypto.subtle.importKey(
    "raw",
    cekBytes,
    "AES-GCM",
    false,
    ["encrypt"],
  );

  // Nonce
  const nonceInfo = new TextEncoder().encode("Content-Encoding: nonce\0");
  const nonceBytes = new Uint8Array(await hkdfExpand(prk, nonceInfo, 12));

  return { contentKey, nonce: nonceBytes, salt };
}

function addPadding(data: Uint8Array): Uint8Array {
  // RFC 8188 Section 2: data || delimiter (0x02 for final record)
  const padded = new Uint8Array(data.length + 1);
  padded.set(data, 0);
  padded[data.length] = 2;
  return padded;
}

async function hkdfExtract(
  salt: Uint8Array,
  ikm: Uint8Array,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    salt,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const result = await crypto.subtle.sign("HMAC", key, ikm);
  return new Uint8Array(result);
}

async function hkdfExpand(
  prk: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    "raw",
    prk,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  // Single iteration (length <= 32 for SHA-256)
  const input = new Uint8Array(info.length + 1);
  input.set(info, 0);
  input[info.length] = 1;
  const result = await crypto.subtle.sign("HMAC", key, input);
  return result.slice(0, length);
}

async function createVapidJwt(
  endpoint: string,
  signingKey: CryptoKey,
  vapidPublicKey: string,
  subject: string,
): Promise<string> {
  const aud = new URL(endpoint).origin;
  const exp = Math.floor(Date.now() / 1000) + 12 * 60 * 60; // 12 hours

  const header = uint8ArrayToBase64Url(
    new TextEncoder().encode(JSON.stringify({ typ: "JWT", alg: "ES256" })),
  );
  const payload = uint8ArrayToBase64Url(
    new TextEncoder().encode(JSON.stringify({ aud, exp, sub: subject })),
  );

  const data = new TextEncoder().encode(`${header}.${payload}`);
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    signingKey,
    data,
  );

  // Web Crypto may return raw (64-byte r||s) or DER-encoded signatures.
  // Detect format and convert to raw if needed.
  const sigBytes = new Uint8Array(signature);
  const rawSig = sigBytes.length === 64 ? sigBytes : derToRaw(sigBytes);
  const sig = uint8ArrayToBase64Url(rawSig);

  return `${header}.${payload}.${sig}`;
}

function derToRaw(der: Uint8Array): Uint8Array {
  // ECDSA signatures from Web Crypto are in DER format
  // Convert to raw 64-byte (r || s) format
  const raw = new Uint8Array(64);

  // Skip sequence tag + length
  let offset = 2;

  // R value
  const rLength = der[offset + 1];
  offset += 2;
  const rStart = rLength > 32 ? offset + (rLength - 32) : offset;
  const rDest = rLength < 32 ? 32 - rLength : 0;
  raw.set(der.slice(rStart, offset + rLength), rDest);
  offset += rLength;

  // S value
  const sLength = der[offset + 1];
  offset += 2;
  const sStart = sLength > 32 ? offset + (sLength - 32) : offset;
  const sDest = sLength < 32 ? 64 - sLength : 32;
  raw.set(der.slice(sStart, offset + sLength), sDest);

  return raw;
}

// ---------------------------------------------------------------------------
// Edge Function handler
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Only allow calls from service_role (internal triggers / edge functions).
  // Gateway verify_jwt is disabled so we check auth ourselves.
  // The SUPABASE_SERVICE_ROLE_KEY env var uses the new sb_ format, but
  // pg_net/vault may send the original JWT-format key. Accept either by
  // also verifying the decoded JWT payload contains role: "service_role".
  const authHeader = req.headers.get("Authorization");
  const token = authHeader?.replace("Bearer ", "") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  let authorized = false;
  if (token === serviceKey) {
    authorized = true;
  } else if (token) {
    try {
      const payloadB64 = token.split(".")[1];
      const payload = JSON.parse(atob(payloadB64));
      authorized = payload.role === "service_role";
    } catch { /* invalid token */ }
  }

  if (!authorized) {
    return new Response(
      JSON.stringify({ error: "Forbidden" }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }

  const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidPublicKey = Deno.env.get("NEXT_PUBLIC_VAPID_PUBLIC_KEY");
  const vapidSubject =
    Deno.env.get("VAPID_SUBJECT") ?? "mailto:noreply@motivefaith.app";

  if (!vapidPrivateKey || !vapidPublicKey) {
    return new Response(
      JSON.stringify({ error: "VAPID keys not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const body: PushPayload = await req.json();

  if (!body.subscription?.endpoint || !body.subscription?.keys) {
    return new Response(JSON.stringify({ error: "Invalid subscription" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // SSRF protection: only allow HTTPS endpoints on known push service domains.
  // Push subscription endpoints are user-controlled (stored in profiles), so a
  // malicious user could set theirs to an internal URL (e.g. cloud metadata).
  try {
    const endpointUrl = new URL(body.subscription.endpoint);
    if (endpointUrl.protocol !== "https:") {
      return new Response(
        JSON.stringify({ error: "Push endpoint must use HTTPS" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    const ALLOWED_PUSH_DOMAINS = [
      ".push.services.mozilla.com",
      ".googleapis.com",
      ".windows.com",
      ".notify.windows.com",
      ".push.apple.com",
      ".web.push.apple.com",
    ];
    const host = endpointUrl.hostname.toLowerCase();
    const isAllowed = ALLOWED_PUSH_DOMAINS.some(
      (domain) => host === domain.slice(1) || host.endsWith(domain),
    );
    if (!isAllowed) {
      console.error(`Blocked push to disallowed host: ${host}`);
      return new Response(
        JSON.stringify({ error: "Push endpoint domain not allowed" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid push endpoint URL" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const payload = JSON.stringify({
    title: body.title,
    body: body.body,
    url: body.url ?? "/main/dashboard",
    type: body.type ?? "completion",
  });

  const success = await sendWebPush(
    body.subscription,
    payload,
    vapidPrivateKey,
    vapidPublicKey,
    vapidSubject,
  );

  if (!success) {
    // If push failed (likely expired subscription), clean up.
    // serviceRoleKey is already validated above; SUPABASE_URL must also be set.
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (supabaseUrl && serviceRoleKey && body.user_id) {
      const supabase = createClient(supabaseUrl, serviceRoleKey);

      // Remove stale subscription — always scope by both endpoint AND user_id
      // to avoid accidentally clearing another user's subscription.
      await supabase
        .from("profiles")
        .update({ push_subscription: null })
        .eq("id", body.user_id)
        .filter("push_subscription->>endpoint", "eq", body.subscription.endpoint);
    }

    return new Response(JSON.stringify({ error: "Push delivery failed" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
