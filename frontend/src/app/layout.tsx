import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Mercosur News",
  description: "Mercosur news intelligence feed",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

function ThemeInitScript() {
  // Runs before React hydration, so theme class is correct from first paint.
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
  // Register SW after load; safe and minimal. Doesn't affect layout/hydration.
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
        <ThemeInitScript />
        <ServiceWorkerRegisterScript />

        <meta name="theme-color" content="#000000" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-white text-black dark:bg-black dark:text-white min-h-screen`}
      >
        {children}
      </body>
    </html>
  );
}