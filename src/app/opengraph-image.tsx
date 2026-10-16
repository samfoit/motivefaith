import { ImageResponse } from "next/og";
import { OgCard, WeekScene, OG_SIZE, OG_CONTENT_TYPE, ogFonts } from "@/app/_og/card";

export const alt = "MotiveFaith: keep the habits that matter, with friends";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

/** The default preview, for every link without one of its own. */
export default async function Image() {
  return new ImageResponse(
    (
      <OgCard
        headline="Keep the habits that matter"
        subhead="Prayer, scripture, and the practices you want to hold, kept with friends."
        scene={<WeekScene />}
      />
    ),
    { ...size, fonts: await ogFonts() },
  );
}
