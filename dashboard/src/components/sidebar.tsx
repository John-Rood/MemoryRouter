"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { BarChart3, Key, Settings, CreditCard, BookOpen, LogOut, ChevronDown, Play, Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useState } from "react";

interface SidebarProps {
  user: { email: string; name?: string; avatarUrl?: string };
  creditBalanceCents: number;
}

const navigation = [
  { name: "Overview", href: "/", icon: BarChart3 },
  { name: "Testing", href: "/testing", icon: Play },
  { name: "Keys", href: "/keys", icon: Key },
  { name: "Settings", href: "/settings", icon: Settings },
  { name: "Billing", href: "/billing", icon: CreditCard },
];

export function Sidebar({ user, creditBalanceCents }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const balanceDollars = (creditBalanceCents / 100).toFixed(2);
  
  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  };
  
  return (
    <>
      {/* Mobile header */}
      <div className="sticky top-0 z-40 flex h-14 w-full items-center gap-x-4 border-b border-white/[0.04] bg-background/80 backdrop-blur-xl px-4 lg:hidden">
        <Button variant="ghost" size="icon" onClick={() => setMobileOpen(!mobileOpen)}>
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>
        <div className="flex items-center gap-2">
          <Image 
            src="/logo.png" 
            alt="MemoryRouter" 
            width={28} 
            height={28} 
            className="rounded-lg"
          />
          <span className="font-semibold">MemoryRouter</span>
        </div>
        <div className="ml-auto">
          <span className="text-sm font-medium text-neon-green">${balanceDollars}</span>
        </div>
      </div>
      
      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-30 bg-background/80 backdrop-blur-sm lg:hidden" onClick={() => setMobileOpen(false)} />
      )}
      
      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-white/[0.04] bg-background/95 backdrop-blur-xl transition-transform duration-200 lg:translate-x-0 lg:static lg:z-auto",
        mobileOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        {/* Logo */}
        <div className="flex h-14 items-center gap-2 px-6 border-b border-white/[0.04]">
          <Image 
            src="/logo.png" 
            alt="MemoryRouter" 
            width={32} 
            height={32} 
            className="rounded-lg"
          />
          <span className="text-lg font-semibold">MemoryRouter</span>
        </div>
        
        {/* Navigation */}
        <nav className="flex-1 space-y-1 px-3 py-4">
          {navigation.map((item) => {
            const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link 
                key={item.name} 
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                  isActive 
                    ? "bg-primary/10 text-primary border border-primary/20" 
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <item.icon className={cn("h-4 w-4", isActive && "text-primary")} />
                {item.name}
              </Link>
            );
          })}
        </nav>
        
        <Separator className="opacity-50" />
        
        {/* Footer */}
        <div className="p-4 space-y-4">
          {/* Docs link */}
          <a 
            href="https://docs.memoryrouter.ai" 
            target="_blank" 
            rel="noopener noreferrer" 
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <BookOpen className="h-3.5 w-3.5" />
            Documentation
          </a>
          
          {/* Balance card */}
          <div className="stat-card rounded-lg px-4 py-3">
            <p className="text-xs text-muted-foreground mb-1">Credit Balance</p>
            <p className="text-lg font-bold text-neon-green">${balanceDollars}</p>
          </div>
          
          {/* User dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="w-full justify-between text-sm h-auto py-2.5 px-3 hover:bg-muted">
                <span className="truncate text-muted-foreground">{user.email}</span>
                <ChevronDown className="h-3.5 w-3.5 ml-2 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem asChild>
                <Link href="/settings" className="cursor-pointer">
                  <Settings className="mr-2 h-4 w-4" />
                  Account Settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem 
                className="text-destructive focus:text-destructive cursor-pointer" 
                onClick={handleLogout}
              >
                <LogOut className="mr-2 h-4 w-4" />
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
    </>
  );
}
