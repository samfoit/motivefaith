import { ImageResponse } from "next/og";
import { OgCard, OG_SIZE, OG_CONTENT_TYPE, ogFonts } from "@/app/_og/card";

export const alt = "MotiveFaith Privacy Policy";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image() {
  return new ImageResponse(
    <OgCard headline="Privacy Policy" subhead="What MotiveFaith collects, how it's used, and how to delete it." />,
    { ...size, fonts: await ogFonts() },
  );
}
