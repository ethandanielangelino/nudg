import type { Metadata } from "next";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nudg — Your AI-Powered Schedule Assistant",
  description:
    "Never miss a thing. Nudg is your personal AI assistant that manages your schedule, sends reminders via WhatsApp, Telegram, Discord, and Email, and keeps you on track.",
  keywords: ["schedule", "reminders", "AI assistant", "calendar", "productivity"],
  openGraph: {
    title: "Nudg — Your AI-Powered Schedule Assistant",
    description: "Never miss a thing. AI-powered scheduling with smart reminders.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full flex flex-col font-sans">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
