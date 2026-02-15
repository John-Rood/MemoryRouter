import type { Metadata } from 'next'
import { Space_Grotesk, JetBrains_Mono } from 'next/font/google'
import './globals.css'

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'MemoryRouter — Persistent Memory for Any AI Model',
  description:
    'Persistent memory for any AI model. $0.20 per 1M tokens · 50M free. Drop-in API. Works with OpenAI, Anthropic, and 100+ models.',
  icons: {
    icon: '/logo.png',
    apple: '/logo.png',
  },
  openGraph: {
    title: 'MemoryRouter — Persistent Memory for Any AI Model',
    description:
      'Persistent memory for any AI model. $0.20 per 1M tokens · 50M free. Drop-in API. Works with OpenAI, Anthropic, and 100+ models.',
    type: 'website',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${jetbrainsMono.variable}`}>
      <head>
        {/* Preconnect to app domain for faster navigation */}
        <link rel="preconnect" href="https://app.memoryrouter.ai" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://app.memoryrouter.ai" />
        {/* Prefetch the app's main page */}
        <link rel="prefetch" href="https://app.memoryrouter.ai/login" as="document" />
      </head>
      <body className="text-white antialiased overflow-x-hidden">{children}</body>
    </html>
  )
}
