import { ImageResponse } from "next/og";
import { OgCard, FirstScene, OG_SIZE, OG_CONTENT_TYPE, ogFonts } from "@/app/_og/card";

export const alt = "Start keeping the habits that matter on MotiveFaith";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

/**
 * The preview for sign-up and sign-in links, and the rest of /auth. Those
 * pages are client components, which cannot export metadata, so the image is
 * set here for the whole segment.
 */
export default async function Image() {
  return new ImageResponse(
    (
      <OgCard
        headline="Start keeping the habits that matter"
        subhead="Sign up free. Track prayer, scripture, and the practices you want to hold."
        scene={<FirstScene />}
      />
    ),
    { ...size, fonts: await ogFonts() },
  );
}
