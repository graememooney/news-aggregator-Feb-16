import type { Metadata } from "next";
import Script from "next/script";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const GA_ID = process.env.NEXT_PUBLIC_GA_ID || "";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Regional Pulse News",
  description: "Regional News, Translated for You. English-language news coverage from Latin America and Europe.",
  metadataBase: new URL("https://regionalpulsenews.com"),
  manifest: "/manifest.webmanifest",
  openGraph: {
    title: "Regional Pulse News",
    description: "Regional News, Translated for You. English-language news coverage from Latin America and Europe.",
    url: "https://regionalpulsenews.com",
    siteName: "Regional Pulse News",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Regional Pulse News - Regional News, Translated for You",
      },
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Regional Pulse News",
    description: "Regional News, Translated for You. English-language news coverage from Latin America and Europe.",
    images: ["/og-image.png"],
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { url: "/icon-1024.png", sizes: "1024x1024", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  alternates: {
    canonical: "https://regionalpulsenews.com",
  },
};

function ThemeInitScript() {
  const code = `
(function () {
  try {
    var saved = localStorage.getItem("theme");
    var theme = (saved === "light" || saved === "dark") ? saved : "dark";
    var root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
  } catch (e) {}
})();
  `.trim();

  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}

function ServiceWorkerRegisterScript() {
  const code = `
(function () {
  try {
    if (!("serviceWorker" in navigator)) return;

    window.addEventListener("load", function () {
      navigator.serviceWorker.register("/sw.js").catch(function () {
        // silent fail (dev / incognito / etc.)
      });
    });
  } catch (e) {}
})();
  `.trim();

  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {GA_ID && (
          <>
            <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
            <Script id="ga-init" strategy="afterInteractive">{`
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('config', '${GA_ID}');
            `}</Script>
          </>
        )}
        <ThemeInitScript />
        <ServiceWorkerRegisterScript />

        {/* Structured data: NewsMediaOrganization for Google News */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "NewsMediaOrganization",
              name: "Regional Pulse News",
              url: "https://regionalpulsenews.com",
              logo: {
                "@type": "ImageObject",
                url: "https://regionalpulsenews.com/icon-512.png",
                width: 512,
                height: 512,
              },
              sameAs: [],
              description:
                "English-language news aggregator covering Latin America and Europe. Translated headlines and summaries from regional sources.",
              foundingDate: "2025",
              actionableFeedbackPolicy: "https://regionalpulsenews.com/about",
              correctionsPolicy: "https://regionalpulsenews.com/about",
              ethicsPolicy: "https://regionalpulsenews.com/about",
              masthead: "https://regionalpulsenews.com/about",
              publishingPrinciples: "https://regionalpulsenews.com/about",
            }),
          }}
        />

        {/* Structured data: WebSite with SearchAction for sitelinks search */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebSite",
              name: "Regional Pulse News",
              url: "https://regionalpulsenews.com",
              potentialAction: {
                "@type": "SearchAction",
                target: {
                  "@type": "EntryPoint",
                  urlTemplate: "https://regionalpulsenews.com/?q={search_term_string}",
                },
                "query-input": "required name=search_term_string",
              },
            }),
          }}
        />

        <meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)" />
        <meta name="theme-color" content="#faf9f7" media="(prefers-color-scheme: light)" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-[#faf9f7] text-gray-950 dark:bg-black dark:text-white min-h-screen`}
      >
        {children}
      </body>
    </html>
  );
}