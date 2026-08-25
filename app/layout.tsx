import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const departureMono = localFont({
  src: "./font/DepartureMono-Regular.woff",
  variable: "--font-departure-mono",
});

export const metadata: Metadata = {
  title: "BayWheel(.ing) | Interactive Bay Area Bike-Share Visualization",
  description: "Explore Bay Area bike-share patterns with BayWheels open data. Interactive visualization of trip patterns across San Francisco, Oakland, and San Jose.",
  keywords: ["Bay Wheels", "bike share", "Bay Area", "data visualization", "interactive map"],
  openGraph: {
    title: "BayWheel(ing) | Interactive Bay Area Bike-Share Visualization",
    description: "Explore Bay Area bike-share patterns with Baywheels open data. Interactive visualization of trip patterns across San Francisco, Oakland, and San Jose.",
    url: "https://baywheeling.com",
    siteName: "BayWheel(.ing)",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "BayWheel(ing) | Interactive Bay Area Bike-Share Visualization",
    description: "Explore Bay Area bike-share patterns with BayWheels open data.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={departureMono.variable}>
    <body className="font-mono">
    <main
        className="w-full h-full items-center justify-center bg-background"
    >
      <ThemeProvider
          attribute="class"
          forcedTheme="dark"
          disableTransitionOnChange
      >
        {children}
      </ThemeProvider>
    </main>
    </body>
    </html>
  );
}
