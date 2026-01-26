"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { BarChart3, Key, Settings, CreditCard, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { useState } from "react";
import { UserNav } from "./user-nav";

const navItems = [
  { href: "/dashboard", label: "Overview", icon: BarChart3 },
  { href: "/dashboard/keys", label: "Keys", icon: Key },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
  { href: "/dashboard/billing", label: "Billing", icon: CreditCard },
];

function SidebarContent({ onNav }: { onNav?: () => void }) {
  const pathname = usePathname();
  return (
    <div className="flex flex-col h-full">
      <div className="p-6"><Link href="/dashboard" onClick={onNav} className="flex items-center gap-2"><span className="text-xl">🧠</span><span className="text-lg font-bold">MemoryRouter</span></Link></div>
      <nav className="flex-1 px-3">
        <ul className="space-y-1">
          {navItems.map((item) => {
            const active = item.href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(item.href);
            return <li key={item.href}><Link href={item.href} onClick={onNav} className={cn("flex items-center gap-3 rounded-lg px-3 py-2 text-sm", active ? "bg-secondary font-medium" : "text-muted-foreground hover:bg-secondary/50")}><item.icon className="h-4 w-4" />{item.label}</Link></li>;
          })}
        </ul>
      </nav>
      <div className="border-t p-4 text-sm"><span className="text-muted-foreground">Credit: </span><span className="font-medium">$15.42</span></div>
    </div>
  );
}
export function Sidebar() { return <aside className="hidden lg:flex w-64 flex-col border-r bg-card h-screen sticky top-0"><SidebarContent /></aside>; }
export function MobileHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header className="lg:hidden flex items-center justify-between border-b bg-card px-4 py-3 sticky top-0 z-40">
      <div className="flex items-center gap-3">
        <Sheet open={open} onOpenChange={setOpen}><SheetTrigger asChild><Button variant="ghost" size="icon"><Menu className="h-5 w-5" /></Button></SheetTrigger><SheetContent side="left" className="p-0 w-64"><SheetTitle className="sr-only">Nav</SheetTitle><SidebarContent onNav={() => setOpen(false)} /></SheetContent></Sheet>
        <span className="font-bold">🧠 MemoryRouter</span>
      </div>
      <UserNav />
    </header>
  );
}
