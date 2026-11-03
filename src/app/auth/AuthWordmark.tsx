import Link from "next/link";

/*
 * Only the text color transitions: `transition-colors` would also fade the
 * focus outline in from the text color instead of showing Lamp Ink at once.
 */
const HOME_LINK =
  "rounded-sm transition-[color] hover:text-brand-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-ink";

/** The MotiveFaith wordmark as a link to the homepage. */
export function AuthHomeLink() {
  return (
    <Link href="/" className={HOME_LINK}>
      MotiveFaith
    </Link>
  );
}

/**
 * The wordmark atop every auth card, above the card's own heading: the way
 * back to the homepage from any auth screen. Sign in uses `AuthHomeLink`
 * directly, because there the wordmark is the heading.
 */
export function AuthWordmark() {
  return (
    <p className="font-display text-2xl font-medium text-center mb-2">
      <AuthHomeLink />
    </p>
  );
}
