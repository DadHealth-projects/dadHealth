import type { Metadata } from "next";

export const SITE_URL = new URL("https://www.dadhealth.co.uk");

const SOCIAL_IMAGE = {
  url: "/LOGO.png",
  width: 1200,
  height: 630,
  alt: "Dad Health",
};

interface MarketingMetadataOptions {
  title: string;
  description: string;
  path: string;
  absoluteTitle?: boolean;
}

export function createMarketingMetadata({
  title,
  description,
  path,
  absoluteTitle = false,
}: MarketingMetadataOptions): Metadata {
  const socialTitle = absoluteTitle ? title : `${title} | Dad Health`;

  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title: socialTitle,
      description,
      type: "website",
      siteName: "Dad Health",
      url: path,
      images: [SOCIAL_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: socialTitle,
      description,
      images: [SOCIAL_IMAGE],
    },
  };
}
