import { Sidebar } from "@/components/sidebar";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="container max-w-6xl py-6 px-4 lg:px-8 lg:py-8">{children}</div>
      </main>
    </div>
  );
}
