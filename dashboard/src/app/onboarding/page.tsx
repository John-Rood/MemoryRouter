"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Copy, Check, Lock, ExternalLink } from "lucide-react";
import { PROVIDERS } from "@/lib/constants";
import { cn } from "@/lib/utils";

const providerLinks: Record<string, string> = {
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://console.anthropic.com/settings/keys",
  google: "https://aistudio.google.com/apikey",
  openrouter: "https://openrouter.ai/keys",
};

const codeSnippet = `from openai import OpenAI

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
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const generatedKey = "mr_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleContinue = async () => {
    setLoading(true);
    console.log("Save provider key:", { provider: selectedProvider, apiKey });
    setTimeout(() => { setLoading(false); setStep(2); }, 1000);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-lg">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-muted-foreground">Step {step} of 2</p>
          {step === 1 && (
            <Button variant="ghost" size="sm" onClick={() => setStep(2)} className="text-muted-foreground">
              Skip for now
            </Button>
          )}
        </div>

        <Progress value={step * 50} className="mb-8" />

        {step === 1 ? (
          <>
            <div className="text-center mb-6">
              <h1 className="text-2xl font-bold mb-2">Add Your API Key</h1>
              <p className="text-muted-foreground">Bring your own key. We never markup inference costs.</p>
            </div>

            <Card>
              <CardContent className="pt-6 space-y-6">
                <div className="space-y-3">
                  <Label className="text-sm font-medium">Which provider?</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {PROVIDERS.map((provider) => (
                      <button
                        key={provider.id}
                        type="button"
                        onClick={() => setSelectedProvider(provider.id)}
                        className={cn(
                          "flex items-center justify-center rounded-md border px-4 py-3 text-sm font-medium transition-colors",
                          selectedProvider === provider.id
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-input bg-background hover:bg-accent"
                        )}
                      >
                        {provider.name}
                        {selectedProvider === provider.id && <Check className="ml-2 h-4 w-4" />}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium">API Key</Label>
                  <Input
                    type="password"
                    placeholder={selectedProvider ? `${PROVIDERS.find((p) => p.id === selectedProvider)?.prefix || "sk-"}...` : "Select a provider first"}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    disabled={!selectedProvider}
                  />
                  <div className="flex items-start gap-2 text-xs text-muted-foreground">
                    <Lock className="h-3 w-3 mt-0.5 shrink-0" />
                    <span>Your key is encrypted and never logged.</span>
                  </div>
                </div>

                <Button className="w-full" onClick={handleContinue} disabled={!selectedProvider || !apiKey || loading}>
                  {loading ? "Validating..." : "Continue"}
                </Button>
              </CardContent>
            </Card>

            {selectedProvider && (
              <p className="text-center text-sm text-muted-foreground mt-4">
                Need a key?{" "}
                <a href={providerLinks[selectedProvider]} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-4 hover:underline inline-flex items-center gap-1">
                  Get one from {PROVIDERS.find((p) => p.id === selectedProvider)?.name}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </p>
            )}
          </>
        ) : (
          <>
            <div className="text-center mb-6">
              <h1 className="text-2xl font-bold mb-2">You&apos;re Ready!</h1>
              <p className="text-muted-foreground">Your AI now has a photographic memory.</p>
            </div>

            <Card>
              <CardContent className="pt-6 space-y-6">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Your MemoryRouter API Key</Label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 rounded-md bg-muted px-3 py-2 font-mono text-sm break-all">{generatedKey}</code>
                    <Button variant="outline" size="icon" onClick={() => copyToClipboard(generatedKey, "mr-key")}>
                      {copied === "mr-key" ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border" /></div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">Use it like this</span>
                  </div>
                </div>

                <div className="relative">
                  <pre className="rounded-md bg-muted p-4 text-sm font-mono overflow-x-auto"><code>{codeSnippet}</code></pre>
                  <Button variant="outline" size="sm" className="absolute top-2 right-2" onClick={() => copyToClipboard(codeSnippet, "code")}>
                    {copied === "code" ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                  </Button>
                </div>

                <Button className="w-full" onClick={() => router.push("/")}>Go to Dashboard</Button>
              </CardContent>
            </Card>

            <p className="text-center text-sm text-muted-foreground mt-4">50M free tokens - Start building now</p>
          </>
        )}
      </div>
    </div>
  );
}
