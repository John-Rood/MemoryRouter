import { Brain } from "lucide-react";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="mb-8 flex items-center gap-2">
        <Brain className="h-8 w-8" />
        <span className="text-2xl font-bold">MemoryRouter</span>
      </div>
      <p className="mb-8 text-center text-muted-foreground">
        Give your AI a photographic memory
      </p>
      {children}
      <p className="mt-8 text-center text-sm text-muted-foreground">
        50M tokens free \u00b7 No credit card required
      </p>
    </div>
  );
}
