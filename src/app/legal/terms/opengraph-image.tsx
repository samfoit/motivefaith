import { ImageResponse } from "next/og";
import { OgCard, OG_SIZE, OG_CONTENT_TYPE, ogFonts } from "@/app/_og/card";

export const alt = "MotiveFaith Terms of Service";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image() {
  return new ImageResponse(
    <OgCard headline="Terms of Service" subhead="The rules for using MotiveFaith." />,
    { ...size, fonts: await ogFonts() },
  );
}
