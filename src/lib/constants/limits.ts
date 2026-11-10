/**
 * Shared size, rate, and timing limits used across client and server code.
 * Centralised here to avoid magic numbers and duplication.
 */

// --- Upload limits ---
export const MAX_IMAGE_SIZE_MB = 5;
/**
 * Largest video that can be sent. The `completions` bucket's file_size_limit
 * (005_storage.sql) is what enforces it; this copy, which must match it, lets
 * a picked video be refused before it is uploaded instead of after. Phones
 * record 1080p at about 1 MB a second and 4K at three to seven, so where a
 * video can't be shrunk on the phone first (transcode-video), this, not the
 * length, is what a full minute of 1080p or a short 4K clip runs into.
 * Recorded in the app or shrunk, a full-length video is about 20 MB (see
 * VIDEO_BITS_PER_SECOND).
 */
export const MAX_VIDEO_SIZE_MB = 50;
export const MAX_AUDIO_SIZE_MB = 5;
export const MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024;
/**
 * Largest photo that can be picked for an avatar or group photo. It is
 * cropped and shrunk to a small square before upload, so this only guards
 * against a file too big to open, not against storage size — a phone's own
 * camera photos are often over 5 MB.
 */
export const MAX_AVATAR_SOURCE_BYTES = 25 * 1024 * 1024;

// --- Recording limits ---
/**
 * Longest video that can be sent: where the camera stops a take, and how much
 * of a longer video picked from the camera roll is kept. Only the client can
 * hold anyone to it — the server cannot read a video's length.
 *
 * A minute, so there is time to say something to the camera, as there is in
 * a voice note. Raising it costs in step: a full video is stored for good and
 * downloaded on every play, at about a third of a MB a second, and a picked
 * video's re-encode runs in real time, so a full one takes as long as it
 * lasts to prepare.
 */
export const MAX_VIDEO_DURATION_S = 60;
export const MAX_AUDIO_DURATION_S = 120;
/**
 * The bitrates every video is recorded at: the camera's own takes, and a
 * picked video as it is re-encoded (transcode-video). Together about 0.33 MB
 * a second, so a full MAX_VIDEO_DURATION_S video is about 20 MB, well inside
 * MAX_VIDEO_SIZE_MB. Left to the browser, how big a full take came out would
 * be up to each phone.
 */
export const VIDEO_BITS_PER_SECOND = 2_500_000;
export const AUDIO_BITS_PER_SECOND = 128_000;

// --- Content limits ---
export const MAX_MESSAGE_LENGTH = 500;
export const MIN_PASSWORD_LENGTH = 12;

// --- Rate limits (max attempts within the window) ---
export const LOGIN_RATE_LIMIT = 5;
export const FORGOT_PASSWORD_RATE_LIMIT = 3;
export const RATE_LIMIT_WINDOW_MS = 60_000;

// --- Feed ---
/**
 * How far back a friend's journey and a group's timeline show activity.
 * Anything older has expired: the feed list must not preview it or flag it
 * as new, since opening the feed would show nothing.
 */
export const FEED_WINDOW_MS = 24 * 60 * 60 * 1000;

// --- Polling ---
export const FRIEND_POLL_MIN_MS = 45_000;
export const FRIEND_POLL_JITTER_MS = 30_000;

// --- Fetch limits ---
export const MAX_COMPLETIONS_FETCH = 500;

// --- Habit history ---
/** Completions fetched per page of a habit's History tab. */
export const HISTORY_PAGE_SIZE = 50;
/** Days of a habit's activity behind its heatmap, streak and "done today". */
export const HABIT_ACTIVITY_DAYS = 90;
/**
 * Ceiling on that window's rows: a habit logged many times a day still caps
 * out here, and only dates are fetched, so it stays a small read.
 */
export const HABIT_ACTIVITY_MAX_ROWS = 1000;
