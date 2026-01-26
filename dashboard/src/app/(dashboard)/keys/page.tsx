"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CreateMemoryKeyDialog } from "@/components/create-memory-key-dialog";
import { mockProviderKeys, mockMemoryKeys, MEMORYROUTER_API_KEY, MEMORYROUTER_BASE_URL } from "@/lib/mock-data";
import { PROVIDERS } from "@/lib/constants";
import { formatTokens } from "@/lib/utils";
import { Eye, EyeOff, Copy, Plus, MoreHorizontal, ClipboardCopy, BarChart3, Pencil, Trash2, Eraser, Check } from "lucide-react";

export default function KeysPage() {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [addProviderOpen, setAddProviderOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState("");
  const [providerKeyInput, setProviderKeyInput] = useState("");

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const displayKey = revealed ? MEMORYROUTER_API_KEY : "mr_live_" + "\u2022".repeat(48);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Keys</h1>
          <p className="text-muted-foreground">Manage your API keys and memory contexts.</p>
        </div>
        <CreateMemoryKeyDialog />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your MemoryRouter API Key</CardTitle>
          <CardDescription>Use this key in place of your OpenAI/Anthropic key</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <code className="flex-1 overflow-hidden rounded-md border bg-muted px-3 py-2 text-sm font-mono">{displayKey}</code>
            <Button variant="outline" size="icon" onClick={() => setRevealed(!revealed)}>
              {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
            <Button variant="outline" size="icon" onClick={() => handleCopy(MEMORYROUTER_API_KEY, "mr-key")}>
              {copied === "mr-key" ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Base URL: <code className="rounded bg-muted px-1 py-0.5">{MEMORYROUTER_BASE_URL}</code></p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div><CardTitle className="text-base">Provider Keys</CardTitle><CardDescription>Your API keys for AI providers</CardDescription></div>
          <Dialog open={addProviderOpen} onOpenChange={setAddProviderOpen}>
            <DialogTrigger asChild><Button variant="outline" size="sm"><Plus className="mr-1 h-4 w-4" />Add Key</Button></DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader><DialogTitle>Add Provider Key</DialogTitle><DialogDescription>Add your AI provider API key. We encrypt it and never log it.</DialogDescription></DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label>Provider</Label>
                  <Select value={selectedProvider} onValueChange={setSelectedProvider}>
                    <SelectTrigger><SelectValue placeholder="Select a provider" /></SelectTrigger>
                    <SelectContent>{PROVIDERS.map((p) => (<SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>))}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>API Key</Label>
                  <Input type="password" placeholder="sk-..." value={providerKeyInput} onChange={(e) => setProviderKeyInput(e.target.value)} />
                  <p className="text-xs text-muted-foreground">Your key is encrypted and never logged.</p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAddProviderOpen(false)}>Cancel</Button>
                <Button onClick={() => { setAddProviderOpen(false); setSelectedProvider(""); setProviderKeyInput(""); }}>Add Key</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent className="space-y-3">
          {mockProviderKeys.map((pk) => (
            <div key={pk.id} className="flex items-center justify-between rounded-md border px-4 py-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{pk.providerName}</span>
                  {pk.isDefault && <Badge variant="secondary">DEFAULT</Badge>}
                </div>
                <div className="mt-1 font-mono text-xs text-muted-foreground">{pk.maskedKey}</div>
                <div className="mt-1 text-xs text-muted-foreground">Added {pk.addedAt}</div>
              </div>
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive"><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div><CardTitle className="text-base">Memory Keys</CardTitle><CardDescription>Memory keys create isolated memory contexts. Use one per user, per project, or per conversation.</CardDescription></div>
          <CreateMemoryKeyDialog />
        </CardHeader>
        <CardContent className="space-y-3">
          {mockMemoryKeys.map((mk) => (
            <div key={mk.id} className="flex items-center justify-between rounded-md border px-4 py-3">
              <div>
                <div className="text-sm font-medium">{mk.name}</div>
                <div className="mt-1 font-mono text-xs text-muted-foreground">{mk.key}</div>
                <div className="mt-1 text-xs text-muted-foreground">{formatTokens(mk.tokensUsed)} tokens {"\u2022"} Last used {mk.lastUsed}</div>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleCopy(mk.key, mk.id)}>
                  {copied === mk.id ? <Check className="h-4 w-4 text-green-500" /> : <ClipboardCopy className="h-4 w-4" />}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem><ClipboardCopy className="mr-2 h-4 w-4" />Copy Key ID</DropdownMenuItem>
                    <DropdownMenuItem><BarChart3 className="mr-2 h-4 w-4" />View Usage</DropdownMenuItem>
                    <DropdownMenuItem><Pencil className="mr-2 h-4 w-4" />Rename</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem><Eraser className="mr-2 h-4 w-4" />Clear Memory</DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive focus:text-destructive"><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
