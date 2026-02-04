"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Check, Copy, ArrowRight, Eye, EyeOff, Sparkles, Key, Zap, ExternalLink } from "lucide-react";
import { PROVIDERS } from "@/lib/constants";

const steps = [
  { id: 1, title: "Add Provider Key", description: "Connect your AI provider" },
  { id: 2, title: "Get Memory Key", description: "Your unique memory context" },
];

// Provider-specific SDK code examples
type CodeExample = {
  language: string;
  import: string;
  setup: (memoryKey: string) => string;
  comment: string;
};

const getProviderCodeExample = (providerId: string): CodeExample => {
  switch (providerId) {
    case "openai":
      return {
        language: "Python",
        import: "from openai import OpenAI",
        setup: (key) => `client = OpenAI(\n    base_url="https://api.memoryrouter.ai/v1",\n    api_key="${key}"\n)`,
        comment: "# That's it! Your AI now has memory.",
      };
    case "anthropic":
      return {
        language: "Python",
        import: "from anthropic import Anthropic",
        setup: (key) => `client = Anthropic(\n    base_url="https://api.memoryrouter.ai/v1",\n    api_key="${key}"\n)`,
        comment: "# That's it! Your AI now has memory.",
      };
    case "google":
      return {
        language: "Python",
        import: "import google.generativeai as genai",
        setup: (key) => `genai.configure(\n    api_key="${key}",\n    transport="rest",\n    client_options={"api_endpoint": "https://api.memoryrouter.ai"}\n)`,
        comment: "# That's it! Your AI now has memory.",
      };
    // OpenAI-compatible providers
    case "xai":
    case "deepseek":
    case "mistral":
    case "cohere":
    case "openrouter":
    default:
      const providerName = PROVIDERS.find(p => p.id === providerId)?.name || providerId;
      return {
        language: "Python",
        import: "from openai import OpenAI  # OpenAI-compatible",
        setup: (key) => `client = OpenAI(\n    base_url="https://api.memoryrouter.ai/v1",\n    api_key="${key}"\n)`,
        comment: `# ${providerName} uses OpenAI-compatible API. Your AI now has memory.`,
      };
  }
};

export default function OnboardingPage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(1);
  const [provider, setProvider] = useState("");
  const [providerKey, setProviderKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [memoryKey, setMemoryKey] = useState("");
  const [selectedProvider, setSelectedProvider] = useState(""); // Store provider for step 2
  const [copied, setCopied] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [validationError, setValidationError] = useState("");
  
  const handleProviderSubmit = async () => {
    if (!provider || !providerKey) return;
    
    setIsLoading(true);
    setValidationError("");
    
    try {
      // Validate the API key against the provider
      const validateResponse = await fetch("/api/keys/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey: providerKey }),
      });
      
      const validateResult = await validateResponse.json();
      
      if (!validateResult.valid) {
        setValidationError(validateResult.error || "Invalid API key. Please check and try again.");
        setIsLoading(false);
        return;
      }
      
      // Key is valid - save the provider key
      const saveProviderResponse = await fetch("/api/keys/provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey: providerKey }),
      });
      
      if (!saveProviderResponse.ok) {
        const error = await saveProviderResponse.json();
        setValidationError(error.error || "Failed to save provider key.");
        setIsLoading(false);
        return;
      }
      
      // Create a memory key via the backend
      const memoryKeyResponse = await fetch("/api/keys/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Default" }),
      });
      
      if (!memoryKeyResponse.ok) {
        const error = await memoryKeyResponse.json();
        setValidationError(error.error || "Failed to create memory key.");
        setIsLoading(false);
        return;
      }
      
      const memoryKeyResult = await memoryKeyResponse.json();
      setMemoryKey(memoryKeyResult.key.key);
      setSelectedProvider(provider); // Store provider for step 2 code example
      setIsLoading(false);
      setCurrentStep(2);
    } catch (error) {
      console.error("Validation error:", error);
      setValidationError("Could not validate key. Please try again.");
      setIsLoading(false);
    }
  };
  
  const copyToClipboard = () => {
    navigator.clipboard.writeText(memoryKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  
  const completeOnboarding = async () => {
    // In production, this would call the API to mark onboarding complete
    router.push('/');
  };
  
  return (
    <div className="min-h-screen flex items-center justify-center relative">
      {/* Ambient background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-neon-green/5 rounded-full blur-[150px]"></div>
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-neon-blue/5 rounded-full blur-[150px]"></div>
      </div>
      <div className="fixed inset-0 grid-bg pointer-events-none opacity-50"></div>
      
      <div className="relative z-10 w-full max-w-2xl px-4 py-12">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-4">
            <Image 
              src="/logo.png" 
              alt="MemoryRouter" 
              width={40} 
              height={40} 
              className="rounded-xl"
            />
            <span className="text-2xl font-bold">MemoryRouter</span>
          </div>
          <h1 className="text-3xl font-bold mb-2">Welcome! Let&apos;s get you set up</h1>
          <p className="text-muted-foreground">Just 2 quick steps to start using AI with memory</p>
        </div>
        
        {/* Progress */}
        <div className="flex items-center justify-center gap-4 mb-8">
          {steps.map((step, i) => (
            <div key={step.id} className="flex items-center">
              <div className={`
                w-10 h-10 rounded-full flex items-center justify-center font-medium transition-all
                ${currentStep > step.id 
                  ? 'bg-primary text-primary-foreground' 
                  : currentStep === step.id 
                    ? 'bg-primary/20 text-primary border border-primary' 
                    : 'bg-muted text-muted-foreground'
                }
              `}>
                {currentStep > step.id ? <Check className="h-5 w-5" /> : step.id}
              </div>
              {i < steps.length - 1 && (
                <div className={`w-20 h-0.5 mx-2 ${currentStep > step.id ? 'bg-primary' : 'bg-muted'}`} />
              )}
            </div>
          ))}
        </div>
        
        {/* Step 1: Provider Key */}
        {currentStep === 1 && (
          <Card className="glass-card border-border/10">
            <CardHeader className="text-center">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Zap className="h-8 w-8 text-primary" />
              </div>
              <CardTitle className="text-2xl">Add Your AI Provider Key</CardTitle>
              <CardDescription className="text-base">
                We use your existing provider keys. You pay them directly — no markup.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 pt-2">
              <div className="space-y-2">
                <Label>Select Provider</Label>
                <Select value={provider} onValueChange={(v) => { setProvider(v); setValidationError(""); }}>
                  <SelectTrigger className="bg-muted/50 h-12">
                    <SelectValue placeholder="Choose your AI provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDERS.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label>API Key</Label>
                <div className="relative">
                  <Input
                    type={showKey ? "text" : "password"}
                    placeholder={PROVIDERS.find(p => p.id === provider)?.placeholder || "Enter your API key"}
                    value={providerKey}
                    onChange={(e) => { setProviderKey(e.target.value); setValidationError(""); }}
                    className="bg-muted/50 h-12 pr-10 font-mono"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full px-3"
                    onClick={() => setShowKey(!showKey)}
                  >
                    {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                {provider && (
                  <p className="text-xs text-muted-foreground">
                    {PROVIDERS.find(p => p.id === provider)?.formatHint}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Your key is encrypted and stored securely. We never see the plaintext.
                </p>
                {validationError && (
                  <p className="text-sm text-red-500 mt-2">
                    ❌ {validationError}
                  </p>
                )}
              </div>
              
              <Button 
                className="btn-neon w-full h-12 text-base"
                disabled={!provider || !providerKey || isLoading}
                onClick={handleProviderSubmit}
              >
                {isLoading ? (
                  "Validating key..."
                ) : (
                  <>
                    Continue
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
              
              {/* Dynamic provider link */}
              {(() => {
                const selectedProvider = PROVIDERS.find(p => p.id === provider);
                const displayName = selectedProvider?.name || "your provider";
                const apiKeyUrl = selectedProvider?.apiKeyUrl || "https://platform.openai.com/api-keys";
                return (
                  <p className="text-center text-sm text-muted-foreground">
                    Don&apos;t have a key?{" "}
                    <a 
                      href={apiKeyUrl} 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className="text-primary hover:underline inline-flex items-center gap-1"
                    >
                      Get one from {displayName}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </p>
                );
              })()}
            </CardContent>
          </Card>
        )}
        
        {/* Step 2: Memory Key */}
        {currentStep === 2 && (
          <Card className="glass-card border-primary/20">
            <CardHeader className="text-center">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Key className="h-8 w-8 text-primary" />
              </div>
              <CardTitle className="text-2xl">Your Memory Key is Ready!</CardTitle>
              <CardDescription className="text-base">
                Use this key to give your AI persistent memory
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 pt-2">
              {/* Memory Key Display */}
              <div className="space-y-2">
                <Label>Memory Key</Label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-muted/50 rounded-lg px-4 py-3 font-mono text-sm break-all border border-primary/30">
                    {memoryKey}
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-12 w-12 border-primary/30"
                    onClick={copyToClipboard}
                  >
                    {copied ? <Check className="h-5 w-5 text-primary" /> : <Copy className="h-5 w-5" />}
                  </Button>
                </div>
              </div>
              
              {/* Code Example */}
              {(() => {
                const codeExample = getProviderCodeExample(selectedProvider);
                return (
                  <div className="space-y-2">
                    <Label>Quick Start</Label>
                    <div className="code-window rounded-xl overflow-hidden">
                      <div className="flex items-center gap-2 px-4 py-2 border-b border-border/10 bg-white/5">
                        <div className="flex gap-1.5">
                          <div className="w-2.5 h-2.5 rounded-full bg-red-500/70"></div>
                          <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/70"></div>
                          <div className="w-2.5 h-2.5 rounded-full bg-green-500/70"></div>
                        </div>
                        <span className="text-xs text-muted-foreground ml-2">{codeExample.language}</span>
                      </div>
                      <pre className="p-4 text-sm overflow-x-auto">
                        <code>
                          <span className="text-purple-400">{codeExample.import}</span>{'\n\n'}
                          <span dangerouslySetInnerHTML={{ 
                            __html: codeExample.setup(memoryKey)
                              .replace(/"https:\/\/api\.memoryrouter\.ai[^"]*"/g, '<span class="neon-text">$&</span>')
                              .replace(new RegExp(`"${memoryKey}"`, 'g'), `<span class="neon-text">"${memoryKey}"</span>`)
                          }} />{'\n\n'}
                          <span className="text-gray-500">{codeExample.comment}</span>
                        </code>
                      </pre>
                    </div>
                  </div>
                );
              })()}
              
              {/* Free tier badge */}
              <div className="flex items-center justify-center gap-2 py-3 bg-primary/5 rounded-lg border border-primary/20">
                <Sparkles className="h-5 w-5 text-primary" />
                <span className="text-sm font-medium">50M tokens free to get started!</span>
              </div>
              
              <Button 
                className="btn-neon w-full h-12 text-base"
                onClick={completeOnboarding}
              >
                Go to Dashboard
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
