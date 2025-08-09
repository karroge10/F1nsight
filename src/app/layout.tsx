import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Navbar } from "@/components/layout/navbar";
import { ThemeProvider } from "@/components/theme-provider";
import { LoadingProvider } from "@/components/loading-provider";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "F1 Analytics Pro - Ultimate Formula 1 Data Platform",
  description: "Comprehensive Formula 1 analytics with AI-powered predictions, real-time data, and premium insights.",
  generator: "v0.dev",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <LoadingProvider>
            <Navbar />
            <main className="page-enter page-enter-active">{children}</main>
          </LoadingProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
