import { ImageResponse } from "next/og";
import { OgCard, OG_SIZE, OG_CONTENT_TYPE, ogFonts } from "@/app/_og/card";

export const alt = "MotiveFaith — faith-driven accountability habit tracker";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

/** The default preview, for every link that is not a personal invite. */
export default async function Image() {
  return new ImageResponse(
    (
      <OgCard
        headline="Keep the habits that matter"
        subhead="Prayer, scripture, and the practices you want to hold — with people who keep you honest."
        pill="Start your streak"
      />
    ),
    { ...size, fonts: await ogFonts() },
  );
}
