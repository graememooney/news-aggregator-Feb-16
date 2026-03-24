import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About | Regional Pulse News",
  description:
    "Regional Pulse News delivers English-language news coverage from Latin America and Europe. Learn about our mission, editorial approach, and how the app works.",
  openGraph: {
    title: "About | Regional Pulse News",
    description:
      "Regional Pulse News delivers English-language news coverage from Latin America and Europe.",
    url: "https://regionalpulsenews.com/about",
  },
};

export default function AboutPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-16">
      <Link
        href="/"
        className="mb-8 inline-flex items-center gap-2 text-sm text-blue-600 hover:underline dark:text-blue-400"
      >
        ← Back to headlines
      </Link>

      <h1 className="text-4xl font-extrabold tracking-tight text-gray-950 dark:text-white sm:text-5xl">
        About <span className="text-blue-500">Regional Pulse</span> News
      </h1>

      <section className="mt-8 space-y-6 text-base leading-relaxed text-gray-700 dark:text-gray-300">
        <p>
          Regional Pulse News is an English-language news aggregator covering Latin America and
          Europe. We collect headlines from trusted regional sources, translate them into English,
          and present them in a single, clean feed so you can follow what is happening across
          multiple countries without switching between dozens of local-language sites.
        </p>

        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Our mission</h2>
        <p>
          Regional news matters, but most of it never reaches an English-speaking audience. Our goal
          is to bridge that gap: one feed, multiple countries, everything in English. No accounts
          required, no clutter, no bias.
        </p>

        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">How it works</h2>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            We monitor public RSS feeds from established newspapers, news agencies, and broadcasters
            across our coverage regions.
          </li>
          <li>
            Headlines and summaries are translated into English automatically as stories are
            published.
          </li>
          <li>
            When multiple outlets cover the same story, we group them into a single card so you get
            one clean summary instead of duplicates.
          </li>
          <li>
            Every story links back to the original source. We never reproduce full articles; we
            always send you to the publisher.
          </li>
        </ul>

        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Editorial approach</h2>
        <p>
          Regional Pulse News is an aggregator, not a newsroom. We do not write original reporting.
          Our editorial role is limited to source selection, translation quality, and story grouping.
          We aim to present a balanced cross-section of regional coverage by including sources from
          across the political spectrum in every country we cover.
        </p>
        <p>
          We do not alter, editorialize, or add commentary to translated headlines and summaries.
          The goal is accurate representation of what each source published.
        </p>

        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Coverage regions</h2>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <strong>South America:</strong> Argentina, Bolivia, Brazil, Chile, Colombia, Ecuador,
            Paraguay, Peru, Uruguay, Venezuela
          </li>
          <li>
            <strong>Mexico:</strong> CDMX, Estado de México, Jalisco, Nuevo León, Yucatán
          </li>
          <li>
            <strong>Central America:</strong> Belize, Costa Rica, El Salvador, Guatemala, Honduras,
            Nicaragua, Panama
          </li>
          <li>
            <strong>Europe:</strong> Croatia, Cyprus, France, Greece, Italy, Malta, Portugal, Spain,
            Turkey
          </li>
        </ul>

        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Source selection</h2>
        <p>
          We include established, publicly accessible news sources. Selection criteria include
          editorial reputation, regularity of publication, and public RSS feed availability. We do
          not include sources that primarily publish misinformation, hate speech, or content that
          violates widely recognized journalistic standards.
        </p>

        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Contact</h2>
        <p>
          We welcome feedback, source suggestions, and corrections. You can reach us through the
          feedback form on the <Link href="/" className="text-blue-600 underline dark:text-blue-400">homepage</Link> or
          by email at{" "}
          <a
            href="mailto:hello@regionalpulsenews.com"
            className="text-blue-600 underline dark:text-blue-400"
          >
            hello@regionalpulsenews.com
          </a>
          .
        </p>

        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Copyright and fair use</h2>
        <p>
          Regional Pulse News respects the intellectual property of all source publishers. We
          display short translated headlines and summaries only. Full article content is never
          reproduced. Every story card links directly to the original publisher so readers can access
          the complete article on the source&apos;s own website.
        </p>
        <p>
          If you are a publisher and have concerns about how your content appears on Regional Pulse
          News, please contact us and we will address it promptly.
        </p>
      </section>

      <div className="mt-12 border-t border-gray-200 pt-6 dark:border-gray-800">
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-full border border-gray-900 bg-gray-900 px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90 dark:border-white dark:bg-white dark:text-black"
        >
          ← Back to headlines
        </Link>
      </div>
    </main>
  );
}
