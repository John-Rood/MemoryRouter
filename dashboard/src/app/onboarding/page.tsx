"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Check, Copy, ArrowRight, Eye, EyeOff, Sparkles, Key, Zap } from "lucide-react";

const providers = [
  { value: "openai", label: "OpenAI", placeholder: "sk-proj-..." },
  { value: "anthropic", label: "Anthropic", placeholder: "sk-ant-..." },
  { value: "google", label: "Google AI", placeholder: "AIza..." },
  { value: "openrouter", label: "OpenRouter", placeholder: "sk-or-..." },
];

const steps = [
  { id: 1, title: "Add Provider Key", description: "Connect your AI provider" },
  { id: 2, title: "Get Memory Key", description: "Your unique memory context" },
];

export default function OnboardingPage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(1);
  const [provider, setProvider] = useState("");
  const [providerKey, setProviderKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [memoryKey, setMemoryKey] = useState("");
  const [copied, setCopied] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  
  const handleProviderSubmit = async () => {
    if (!provider || !providerKey) return;
    
    setIsLoading(true);
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Generate a memory key
    const newMemoryKey = `mk_${Math.random().toString(36).substring(2, 26)}`;
    setMemoryKey(newMemoryKey);
    setIsLoading(false);
    setCurrentStep(2);
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
            <div className="w-10 h-10 rounded-xl bg-gradient-neon flex items-center justify-center">
              <span className="text-black font-bold text-lg">M</span>
            </div>
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
          <Card className="glass-card border-border/50">
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
                <Select value={provider} onValueChange={setProvider}>
                  <SelectTrigger className="bg-muted/50 h-12">
                    <SelectValue placeholder="Choose your AI provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {providers.map((p) => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label>API Key</Label>
                <div className="relative">
                  <Input
                    type={showKey ? "text" : "password"}
                    placeholder={providers.find(p => p.value === provider)?.placeholder || "Enter your API key"}
                    value={providerKey}
                    onChange={(e) => setProviderKey(e.target.value)}
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
                <p className="text-xs text-muted-foreground">
                  Your key is encrypted and stored securely. We never see the plaintext.
                </p>
              </div>
              
              <Button 
                className="btn-neon w-full h-12 text-base"
                disabled={!provider || !providerKey || isLoading}
                onClick={handleProviderSubmit}
              >
                {isLoading ? (
                  "Setting up..."
                ) : (
                  <>
                    Continue
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
              
              <p className="text-center text-sm text-muted-foreground">
                Don&apos;t have a key?{" "}
                <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  Get one from OpenAI
                </a>
              </p>
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
              <div className="space-y-2">
                <Label>Quick Start</Label>
                <div className="code-window rounded-xl overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2 border-b border-border/30 bg-white/5">
                    <div className="flex gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full bg-red-500/70"></div>
                      <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/70"></div>
                      <div className="w-2.5 h-2.5 rounded-full bg-green-500/70"></div>
                    </div>
                    <span className="text-xs text-muted-foreground ml-2">Python</span>
                  </div>
                  <pre className="p-4 text-sm overflow-x-auto">
                    <code>
                      <span className="text-purple-400">from</span> openai <span className="text-purple-400">import</span> OpenAI{'\n\n'}
                      client = OpenAI({'\n'}
                      {'    '}base_url=<span className="neon-text">&quot;https://api.memoryrouter.ai/v1&quot;</span>,{'\n'}
                      {'    '}api_key=<span className="neon-text">&quot;{memoryKey}&quot;</span>{'\n'}
                      ){'\n\n'}
                      <span className="text-gray-500"># That&apos;s it! Your AI now has memory.</span>
                    </code>
                  </pre>
                </div>
              </div>
              
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
