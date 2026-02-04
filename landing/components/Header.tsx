'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import Link from 'next/link'

const navLinks = [
  { href: '#calculator', label: 'Calculator' },
  { href: '#use-cases', label: 'Use Cases' },
  { href: '#how-it-works', label: 'How It Works' },
  { href: '/models', label: 'Models' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#faq', label: 'FAQ' },
]

export function Header() {
  const [isOpen, setIsOpen] = useState(false)

  // Close menu on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [])

  // Prevent body scroll when menu is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  const handleLinkClick = () => {
    setIsOpen(false)
  }

  return (
    <nav className="fixed w-full z-50 bg-[#09090b]/80 backdrop-blur-xl border-b border-white/5">
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center">
        {/* Logo - fixed width, never shrinks */}
        <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition shrink-0">
          <Image src="/logo.png" alt="MemoryRouter" width={32} height={32} className="rounded-lg" />
          <span className="text-xl font-bold whitespace-nowrap">MemoryRouter</span>
        </Link>

        {/* Nav links - centered, hidden on mobile */}
        <div className="hidden lg:flex items-center justify-center gap-6 flex-1 mx-8">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-gray-400 hover:text-white transition text-sm whitespace-nowrap"
            >
              {link.label}
            </a>
          ))}
        </div>

        {/* Desktop CTA */}
        <a
          href="https://app.memoryrouter.ai"
          className="hidden lg:inline-flex btn-primary px-5 py-2.5 rounded-lg text-sm transition shrink-0 whitespace-nowrap"
        >
          Get Started Free
        </a>

        {/* Mobile hamburger button */}
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="lg:hidden ml-auto p-2 text-gray-400 hover:text-white transition"
          aria-label={isOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={isOpen}
        >
          {isOpen ? (
            // X icon
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            // Hamburger icon
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>
      </div>

      {/* Mobile menu overlay */}
      <div
        className={`lg:hidden fixed inset-0 top-[73px] bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => setIsOpen(false)}
      />

      {/* Mobile menu panel */}
      <div
        className={`lg:hidden fixed top-[73px] right-0 h-[calc(100vh-73px)] w-72 bg-[#09090b] border-l border-white/10 transform transition-transform duration-300 ease-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex flex-col p-6">
          {/* Nav links */}
          <div className="flex flex-col gap-2">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={handleLinkClick}
                className="text-gray-300 hover:text-white hover:bg-white/5 px-4 py-3 rounded-lg transition text-base font-medium"
              >
                {link.label}
              </a>
            ))}
          </div>

          {/* Divider */}
          <div className="my-6 border-t border-white/10" />

          {/* Mobile CTA */}
          <a
            href="https://app.memoryrouter.ai"
            onClick={handleLinkClick}
            className="btn-primary px-5 py-3 rounded-lg text-base font-semibold transition text-center"
          >
            Get Started Free
          </a>
        </div>
      </div>
    </nav>
  )
}
