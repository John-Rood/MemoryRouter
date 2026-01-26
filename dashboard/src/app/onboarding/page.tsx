"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { PROVIDERS } from "@/lib/constants";
import { MEMORYROUTER_API_KEY } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import { Brain, Lock, ExternalLink, Copy, Check, ArrowRight } from "lucide-react";
import Link from "next/link";

const providerLinks: Record<string, string> = {
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://console.anthropic.com/settings/keys",
  google: "https://aistudio.google.com/app/apikey",
  openrouter: "https://openrouter.ai/keys",
};

const CODE_SNIPPET = `from openai import OpenAI

client = OpenAI(
    api_key="mr_live_xxxx",  # Your MemoryRouter key
    base_url="https://api.memoryrouter.ai/v1"
)

# That's it. Your AI now remembers everything.
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hi!"}]
)`;

export default function OnboardingPage() {
  const [step, setStep] = useState(1);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  const handleCopy = (text: string, type: "key" | "code") => {
    navigator.clipboard.writeText(text);
    if (type === "key") { setCopiedKey(true); setTimeout(() => setCopiedKey(false), 2000); }
    else { setCopiedCode(true); setTimeout(() => setCopiedCode(false), 2000); }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-lg space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            <span className="text-sm text-muted-foreground">Step {step} of 2</span>
          </div>
          {step === 1 && (
            <Button variant="ghost" size="sm" onClick={() => setStep(2)} className="text-muted-foreground">
              Skip for now <ArrowRight className="ml-1 h-3 w-3" />
            </Button>
          )}
        </div>
        <Progress value={step === 1 ? 50 : 100} className="h-1" />

        {step === 1 ? (
          <>
            <div className="text-center space-y-2">
              <h1 className="text-2xl font-bold">Add Your API Key</h1>
              <p className="text-muted-foreground">Bring your own key. We never markup inference costs.</p>
            </div>
            <div className="rounded-lg border bg-card p-6 space-y-6">
              <div className="space-y-3">
                <Label className="text-sm font-medium">Which provider?</Label>
                <div className="grid grid-cols-2 gap-3">
                  {PROVIDERS.map((provider) => (
                    <button key={provider.id} onClick={() => setSelectedProvider(provider.id)}
                      className={cn("rounded-lg border px-4 py-3 text-sm font-medium transition-colors hover:bg-accent", selectedProvider === provider.id ? "border-primary bg-accent" : "border-border")}>
                      {provider.name}
                      {selectedProvider === provider.id && <Check className="ml-2 inline h-4 w-4 text-green-500" />}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="api-key">API Key</Label>
                <Input id="api-key" type="password"
                  placeholder={selectedProvider ? PROVIDERS.find((p) => p.id === selectedProvider)?.prefix + "..." : "sk-..."}
                  value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
                <div className="flex items-start gap-2 text-xs text-muted-foreground">
                  <Lock className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>Your key is encrypted and never logged. We only use it to forward requests to your chosen provider.</span>
                </div>
              </div>
              <Button className="w-full" size="lg" onClick={() => setStep(2)} disabled={!selectedProvider || !apiKey}>Continue</Button>
            </div>
            {selectedProvider && (
              <p className="text-center text-sm text-muted-foreground">
                Need a key?{" "}
                <a href={providerLinks[selectedProvider]} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline hover:text-foreground">
                  Get one from {PROVIDERS.find((p) => p.id === selectedProvider)?.name}<ExternalLink className="h-3 w-3" />
                </a>
              </p>
            )}
          </>
        ) : (
          <>
            <div className="text-center space-y-2">
              <h1 className="text-2xl font-bold">You&apos;re Ready!</h1>
              <p className="text-muted-foreground">Your AI now has a photographic memory.</p>
            </div>
            <div className="rounded-lg border bg-card p-6 space-y-6">
              <div className="space-y-3">
                <Label className="text-sm font-medium">Your MemoryRouter API Key</Label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded-md border bg-muted px-3 py-2 text-sm font-mono break-all">{MEMORYROUTER_API_KEY}</code>
                  <Button variant="outline" size="icon" onClick={() => handleCopy(MEMORYROUTER_API_KEY, "key")}>
                    {copiedKey ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              <Separator />
              <div className="space-y-3">
                <Label className="text-sm font-medium">Use it like this:</Label>
                <div className="relative">
                  <pre className="overflow-x-auto rounded-md border bg-muted p-4 text-xs font-mono leading-relaxed">{CODE_SNIPPET}</pre>
                  <Button variant="outline" size="sm" className="absolute right-2 top-2" onClick={() => handleCopy(CODE_SNIPPET, "code")}>
                    {copiedCode ? <Check className="mr-1 h-3 w-3 text-green-500" /> : <Copy className="mr-1 h-3 w-3" />}Copy
                  </Button>
                </div>
              </div>
              <Link href="/"><Button className="w-full" size="lg">Go to Dashboard</Button></Link>
            </div>
            <p className="text-center text-sm text-muted-foreground">50M free tokens {"\u2022"} Start building now</p>
          </>
        )}
      </div>
    </div>
  );
}
