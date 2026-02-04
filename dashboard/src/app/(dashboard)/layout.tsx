import { requireUser, getUserBilling } from '@/lib/auth/server';
import { Sidebar } from "@/components/sidebar";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const billing = await getUserBilling(user.id);
  
  return (
    <div className="flex flex-col lg:flex-row min-h-screen">
      {/* Ambient background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/4 w-[400px] h-[400px] bg-neon-green/3 rounded-full blur-[150px]"></div>
        <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-neon-blue/3 rounded-full blur-[150px]"></div>
      </div>
      
      <Sidebar 
        user={{ 
          email: user.email, 
          name: user.name || undefined,
          avatarUrl: user.avatarUrl || undefined,
        }} 
        creditBalanceCents={billing?.creditBalanceCents || 0}
      />
      <main className="flex-1 overflow-auto relative">
        <div className="container max-w-6xl py-6 px-4 lg:px-8 lg:py-8">
          {children}
        </div>
      </main>
    </div>
  );
}
