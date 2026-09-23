import { ImageResponse } from "next/og";
import { parseInviteUsername } from "@/lib/constants/pending-invite";
import { OgCard, OG_SIZE, OG_CONTENT_TYPE, ogFonts } from "@/app/_og/card";

export const alt = "You've been invited to MotiveFaith";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

/**
 * The preview for a shared invite link.
 *
 * It can only name the username, never the display name: this route is fetched
 * by crawlers with no session, and `anon` cannot read profiles at all. That is
 * the same limit the invite page itself lives under, so the two agree.
 */
export default async function Image({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const username = parseInviteUsername((await params).username);

  return new ImageResponse(
    (
      <OgCard
        headline={username ? `@${username} invited you` : "You've been invited"}
        subhead="Track the habits that matter, with people who keep you honest."
        pill="Join them"
      />
    ),
    { ...size, fonts: await ogFonts() },
  );
}
