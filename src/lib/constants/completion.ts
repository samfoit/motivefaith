export const COMPLETION_TYPES = ["photo", "video", "message", "quick"] as const;

export type CompletionType = (typeof COMPLETION_TYPES)[number];

export const VALID_COMPLETION_TYPES = new Set<string>(COMPLETION_TYPES);
