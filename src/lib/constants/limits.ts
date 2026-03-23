/**
 * Shared size, rate, and timing limits used across client and server code.
 * Centralised here to avoid magic numbers and duplication.
 */

// --- Upload limits ---
export const MAX_IMAGE_SIZE_MB = 5;
export const MAX_VIDEO_SIZE_MB = 10;
export const MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024;

// --- Content limits ---
export const MAX_MESSAGE_LENGTH = 500;
export const MIN_PASSWORD_LENGTH = 12;

// --- Rate limits (max attempts within the window) ---
export const LOGIN_RATE_LIMIT = 5;
export const FORGOT_PASSWORD_RATE_LIMIT = 3;
export const RATE_LIMIT_WINDOW_MS = 60_000;

// --- Polling ---
export const FRIEND_POLL_MIN_MS = 45_000;
export const FRIEND_POLL_JITTER_MS = 30_000;

// --- Fetch limits ---
export const MAX_COMPLETIONS_FETCH = 500;
