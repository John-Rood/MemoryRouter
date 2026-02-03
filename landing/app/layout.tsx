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
  title: 'MemoryRouter — $1 on Memory Saves $10 on Inference',
  description:
    'Persistent memory for any AI model. Every $1 on memory saves $10 on inference. Drop-in API. Works with OpenAI, Anthropic, and 100+ models.',
  icons: {
    icon: '/logo.png',
    apple: '/logo.png',
  },
  openGraph: {
    title: 'MemoryRouter — $1 on Memory Saves $10 on Inference',
    description:
      'Persistent memory for any AI model. Every $1 on memory saves $10 on inference. Drop-in API. Works with OpenAI, Anthropic, and 100+ models.',
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
