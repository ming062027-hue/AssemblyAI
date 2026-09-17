import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import {
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_VERSION,
  SITE_YEAR,
} from "@/config/site";
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
  title: {
    default: SITE_NAME,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <div className="flex flex-1 flex-col">{children}</div>
        <footer className="border-t border-black/10 px-6 py-4 text-center text-xs text-black/60 dark:border-white/15 dark:text-white/60">
          © {SITE_YEAR} {SITE_NAME} · Demo data is fictional ·{" "}
          <span data-testid="site-version">{SITE_VERSION}</span>
        </footer>
      </body>
    </html>
  );
}
