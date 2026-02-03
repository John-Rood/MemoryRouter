import type { Metadata } from "next";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import dynamic from "next/dynamic";
import "./globals.css";

// Lazy load toaster - not needed for initial render
const Toaster = dynamic(() => import("sonner").then(mod => mod.Toaster), {
  ssr: false,
});

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
        <Toaster 
          position="bottom-right" 
          theme="dark"
          toastOptions={{
            style: {
              background: 'hsl(240 6% 6%)',
              border: '1px solid rgba(255, 255, 255, 0.05)',
              color: 'white',
            },
          }}
        />
      </body>
    </html>
  );
}
