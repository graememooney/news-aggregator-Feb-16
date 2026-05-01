import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

/* ------------------------------------------------------------------ */
/*  Region config                                                      */
/* ------------------------------------------------------------------ */

const SITE_URL = "https://regionalpulsenews.com";

type RegionInfo = {
  name: string;
  description: string;
  countries: string[];
  sourceCount: number;
};

const REGIONS: Record<string, RegionInfo> = {
  "south-america": {
    name: "South America",
    description:
      "English-language news coverage from South America. Translated headlines and summaries from established newspapers and news agencies across Argentina, Bolivia, Brazil, Chile, Colombia, Ecuador, Paraguay, Peru, Uruguay, and Venezuela.",
    countries: [
      "Argentina",
      "Bolivia",
      "Brazil",
      "Chile",
      "Colombia",
      "Ecuador",
      "Paraguay",
      "Peru",
      "Uruguay",
      "Venezuela",
    ],
    sourceCount: 25,
  },
  mexico: {
    name: "Mexico",
    description:
      "English-language news from Mexico. Translated headlines and summaries from major Mexican newspapers and news outlets covering CDMX, Estado de México, Guanajuato, Jalisco, Nuevo León, Oaxaca, and Yucatán.",
    countries: ["CDMX", "Estado de México", "Guanajuato", "Jalisco", "Nuevo León", "Oaxaca", "Yucatán"],
    sourceCount: 16,
  },
  "central-america": {
    name: "Central America",
    description:
      "English-language news from Central America. Translated headlines from Belize, Costa Rica, El Salvador, Guatemala, Honduras, Nicaragua, and Panama.",
    countries: [
      "Belize",
      "Costa Rica",
      "El Salvador",
      "Guatemala",
      "Honduras",
      "Nicaragua",
      "Panama",
    ],
    sourceCount: 21,
  },
  europe: {
    name: "Europe",
    description:
      "English-language news from Southern Europe and the Mediterranean. Translated headlines and summaries from Croatia, Cyprus, France, Greece, Italy, Malta, Portugal, Spain, and Turkey.",
    countries: [
      "Croatia",
      "Cyprus",
      "France",
      "Greece",
      "Italy",
      "Malta",
      "Portugal",
      "Spain",
      "Turkey",
    ],
    sourceCount: 46,
  },
};

/* ------------------------------------------------------------------ */
/*  Metadata                                                           */
/* ------------------------------------------------------------------ */

type PageProps = {
  params: Promise<{ region: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { region } = await params;
  const info = REGIONS[region];
  if (!info) return { title: "Region not found | Regional Pulse News" };

  return {
    title: `${info.name} News in English | Regional Pulse News`,
    description: info.description,
    openGraph: {
      title: `${info.name} News in English | Regional Pulse News`,
      description: info.description,
      url: `${SITE_URL}/regions/${region}`,
      siteName: "Regional Pulse News",
      type: "website",
    },
    alternates: {
      canonical: `${SITE_URL}/regions/${region}`,
    },
  };
}

export function generateStaticParams() {
  return Object.keys(REGIONS).map((region) => ({ region }));
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default async function RegionPage({ params }: PageProps) {
  const { region } = await params;
  const info = REGIONS[region];
  if (!info) notFound();

  // FAQ schema for GEO
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: `How can I read ${info.name} news in English?`,
        acceptedAnswer: {
          "@type": "Answer",
          text: `Regional Pulse News translates headlines and summaries from ${info.sourceCount} ${info.name} news sources into English. Visit regionalpulsenews.com and select the ${info.name} region to browse the latest translated headlines.`,
        },
      },
      {
        "@type": "Question",
        name: `What countries does Regional Pulse News cover in ${info.name}?`,
        acceptedAnswer: {
          "@type": "Answer",
          text: `We cover news from ${info.countries.join(", ")}. Each country has multiple established news sources in our feed.`,
        },
      },
      {
        "@type": "Question",
        name: `Is Regional Pulse News free?`,
        acceptedAnswer: {
          "@type": "Answer",
          text: "Yes, Regional Pulse News is free to use. We offer an optional subscription ($1.99/month or $11.99/year) to remove ads and support the service.",
        },
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />

      <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-16">
        <Link
          href="/"
          className="mb-8 inline-flex items-center gap-2 text-sm text-blue-600 hover:underline dark:text-blue-400"
        >
          ← Back to headlines
        </Link>

        <h1 className="text-4xl font-extrabold tracking-tight text-gray-950 dark:text-white sm:text-5xl">
          {info.name} <span className="text-blue-500">News in English</span>
        </h1>

        <p className="mt-4 text-lg leading-relaxed text-gray-600 dark:text-gray-400">
          {info.description}
        </p>

        <section className="mt-8">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Coverage</h2>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            We monitor <strong>{info.sourceCount} sources</strong> across{" "}
            <strong>{info.countries.length}</strong>{" "}
            {info.countries.length === 1 ? "area" : region === "mexico" ? "states" : "countries"}.
          </p>
          <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {info.countries.map((c) => (
              <li
                key={c}
                className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-800 dark:border-gray-800 dark:bg-gray-900/50 dark:text-gray-200"
              >
                {c}
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-8">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">How it works</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-6 text-gray-600 dark:text-gray-400">
            <li>We monitor RSS feeds from established {info.name} newspapers and news agencies.</li>
            <li>New articles are detected as they publish, typically within minutes.</li>
            <li>Headlines and short summaries are translated into English automatically.</li>
            <li>Stories about the same event from different sources are grouped together.</li>
            <li>Each story links to the original publisher so you can read the full article.</li>
          </ol>
        </section>

        <section className="mt-8">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            Frequently asked questions
          </h2>
          <dl className="mt-4 space-y-5">
            <div>
              <dt className="font-semibold text-gray-900 dark:text-white">
                How can I read {info.name} news in English?
              </dt>
              <dd className="mt-1 text-gray-600 dark:text-gray-400">
                Visit Regional Pulse News and select the {info.name} region. All headlines and
                summaries are translated into English automatically. Clicking any story opens the
                original article with Google Translate applied.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-gray-900 dark:text-white">
                Is it free?
              </dt>
              <dd className="mt-1 text-gray-600 dark:text-gray-400">
                Yes. The core service is completely free. An optional subscription ($1.99/month or
                $11.99/year) removes ads and supports continued development.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-gray-900 dark:text-white">
                How often is the feed updated?
              </dt>
              <dd className="mt-1 text-gray-600 dark:text-gray-400">
                Continuously. New stories appear within minutes of being published by the original
                source.
              </dd>
            </div>
          </dl>
        </section>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            href={`/?region=${encodeURIComponent(region)}`}
            className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            Browse {info.name} headlines →
          </Link>
          <Link
            href="/about"
            className="inline-flex items-center gap-2 rounded-full border border-gray-300 px-6 py-3 text-sm font-medium text-gray-700 transition hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            About Regional Pulse News
          </Link>
        </div>
      </main>
    </>
  );
}
