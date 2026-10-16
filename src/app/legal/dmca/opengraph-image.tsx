import { ImageResponse } from "next/og";
import { OgCard, OG_SIZE, OG_CONTENT_TYPE, ogFonts } from "@/app/_og/card";

export const alt = "MotiveFaith DMCA Policy";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image() {
  return new ImageResponse(
    <OgCard headline="DMCA Policy" subhead="How to report content that infringes your copyright." />,
    { ...size, fonts: await ogFonts() },
  );
}
