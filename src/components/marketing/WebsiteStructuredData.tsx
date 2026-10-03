import { SITE_URL } from "@/lib/marketingMetadata";

const organizationId = new URL("/#organization", SITE_URL).toString();

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": organizationId,
      name: "Dad Health Ltd",
      url: SITE_URL.origin,
      logo: new URL("/icon.svg", SITE_URL).toString(),
      email: "hello@dadhealth.co.uk",
      address: {
        "@type": "PostalAddress",
        streetAddress: "66 Paul Street",
        addressLocality: "London",
        postalCode: "EC2A 4NA",
        addressCountry: "GB",
      },
    },
    {
      "@type": "WebSite",
      "@id": new URL("/#website", SITE_URL).toString(),
      name: "Dad Health",
      url: SITE_URL.origin,
      publisher: { "@id": organizationId },
    },
  ],
};

export default function WebsiteStructuredData() {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
      }}
    />
  );
}
