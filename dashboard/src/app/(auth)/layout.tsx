export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center relative">
      {/* Ambient background effects */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-neon-green/5 rounded-full blur-[150px]"></div>
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-neon-blue/5 rounded-full blur-[150px]"></div>
      </div>
      
      {/* Grid background */}
      <div className="fixed inset-0 grid-bg pointer-events-none opacity-50"></div>
      
      {/* Content */}
      <div className="relative z-10 w-full px-4 py-12">
        {children}
      </div>
    </div>
  );
}
