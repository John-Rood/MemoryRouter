import type { Metadata } from "next";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import { ToasterWrapper } from "@/components/toaster-wrapper";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({ 
  subsets: ["latin"],
  variable: "--font-sans",
});

const jetbrainsMono = JetBrains_Mono({ 
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "MemoryRouter Dashboard",
  description: "Manage your AI memory keys, billing, and usage",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${spaceGrotesk.variable} ${jetbrainsMono.variable} font-sans antialiased`}>
        {children}
        <ToasterWrapper />
      </body>
    </html>
  );
}
