"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { mockStats } from "@/lib/mock-data";
import { BarChart3, Key, Settings, CreditCard, Brain, BookOpen, MessageCircle, Twitter, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useState } from "react";

const navItems = [
  { href: "/", label: "Overview", icon: BarChart3 },
  { href: "/keys", label: "Keys", icon: Key },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/billing", label: "Billing", icon: CreditCard },
];

export function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const bal = mockStats.creditBalance;
  return (
    <>
      <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between border-b bg-background px-4 py-3 md:hidden">
        <div className="flex items-center gap-2"><Brain className="h-5 w-5" /><span className="font-semibold">MemoryRouter</span></div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">${bal.toFixed(2)}</span>
          <Button variant="ghost" size="icon" onClick={() => setMobileOpen(!mobileOpen)}>
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>
      {mobileOpen && <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={() => setMobileOpen(false)} />}
      <aside className={cn("fixed left-0 top-0 z-40 flex h-full w-64 flex-col border-r bg-background transition-transform duration-200 md:translate-x-0", mobileOpen ? "translate-x-0" : "-translate-x-full")}>
        <div className="flex items-center gap-2 px-6 py-5"><Brain className="h-6 w-6" /><span className="text-lg font-semibold">MemoryRouter</span></div>
        <Separator />
        <nav className="flex-1 px-3 py-4">
          <div className="space-y-1">
            {navItems.map((item) => {
              const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return (
                <Link key={item.href} href={item.href} onClick={() => setMobileOpen(false)}
                  className={cn("flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors", isActive ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground")}>
                  <item.icon className="h-4 w-4" />{item.label}
                </Link>
              );
            })}
          </div>
        </nav>
        <div className="px-3 pb-4">
          <Separator className="mb-4" />
          <div className="mb-4 flex items-center justify-center gap-4">
            <a href="https://docs.memoryrouter.ai" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground"><BookOpen className="h-4 w-4" /></a>
            <a href="https://discord.gg/memoryrouter" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground"><MessageCircle className="h-4 w-4" /></a>
            <a href="https://twitter.com/memoryrouter" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground"><Twitter className="h-4 w-4" /></a>
          </div>
          <div className="rounded-md border bg-card px-3 py-2 text-center">
            <div className="text-xs text-muted-foreground">Credit Balance</div>
            <div className="text-sm font-semibold">${bal.toFixed(2)} <span className="text-xs text-muted-foreground">({bal.toFixed(1)}M tkns)</span></div>
          </div>
        </div>
      </aside>
    </>
  );
}
