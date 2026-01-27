"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Eye, EyeOff, Copy, Plus, MoreHorizontal, Trash2, Pencil, BarChart3, Eraser, Check } from "lucide-react";
import { formatTokens, PROVIDERS, RETENTION_OPTIONS } from "@/lib/constants";

const mockApiKey = "mr_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
const mockProviderKeys = [
  { id: "pk_1", provider: "OpenAI", maskedKey: "sk-proj-************xxxx", addedAt: "Jan 15, 2026", isDefault: true },
  { id: "pk_2", provider: "Anthropic", maskedKey: "sk-ant-************xxxx", addedAt: "Jan 20, 2026", isDefault: false },
];
const mockMemoryKeys = [
  { id: "mk_1", name: "main-assistant", keyId: "mk_xxxxxxxxxxxx", tokens: 3_200_000, lastUsed: "2 min ago" },
  { id: "mk_2", name: "user-12345", keyId: "mk_yyyyyyyyyyyy", tokens: 890_000, lastUsed: "1 hour ago" },
  { id: "mk_3", name: "project-alpha", keyId: "mk_zzzzzzzzzzzz", tokens: 12_100_000, lastUsed: "3 days ago" },
];

export default function KeysPage() {
  const [apiKeyRevealed, setApiKeyRevealed] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [newKeyOpen, setNewKeyOpen] = useState(false);
  const [addProviderOpen, setAddProviderOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyRetention, setNewKeyRetention] = useState("90");
  const [newProvider, setNewProvider] = useState("");
  const [newProviderKey, setNewProviderKey] = useState("");

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Keys</h1>
        <p className="text-muted-foreground">Manage your API keys and memory contexts.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your MemoryRouter API Key</CardTitle>
          <CardDescription>Use this key in place of your OpenAI/Anthropic key</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-md bg-muted px-3 py-2 font-mono text-sm">
              {apiKeyRevealed ? mockApiKey : "mr_live_****************************************"}
            </code>
            <Button variant="outline" size="icon" onClick={() => setApiKeyRevealed(!apiKeyRevealed)}>
              {apiKeyRevealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
            <Button variant="outline" size="icon" onClick={() => copyToClipboard(mockApiKey, "api-key")}>
              {copied === "api-key" ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Base URL: <code className="rounded bg-muted px-1 py-0.5">https://api.memoryrouter.ai/v1</code>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Provider Keys</CardTitle>
            <CardDescription>Your underlying AI provider API keys</CardDescription>
          </div>
          <Dialog open={addProviderOpen} onOpenChange={setAddProviderOpen}>
            <DialogTrigger asChild><Button size="sm"><Plus className="mr-1 h-3 w-3" />Add Key</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Provider Key</DialogTitle>
                <DialogDescription>Add your AI provider API key. It will be encrypted and stored securely.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Provider</Label>
                  <Select value={newProvider} onValueChange={setNewProvider}>
                    <SelectTrigger><SelectValue placeholder="Select a provider" /></SelectTrigger>
                    <SelectContent>
                      {PROVIDERS.map((p) => (<SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>API Key</Label>
                  <Input type="password" placeholder="sk-..." value={newProviderKey} onChange={(e) => setNewProviderKey(e.target.value)} />
                  <p className="text-xs text-muted-foreground">Your key is encrypted and never logged.</p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAddProviderOpen(false)}>Cancel</Button>
                <Button onClick={() => { setAddProviderOpen(false); setNewProvider(""); setNewProviderKey(""); }} disabled={!newProvider || !newProviderKey}>Add Key</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent className="space-y-3">
          {mockProviderKeys.map((key) => (
            <div key={key.id} className="flex items-center justify-between rounded-md border px-4 py-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{key.provider}</span>
                  {key.isDefault && <Badge variant="secondary" className="text-xs">DEFAULT</Badge>}
                </div>
                <p className="text-xs font-mono text-muted-foreground">{key.maskedKey}</p>
                <p className="text-xs text-muted-foreground">Added {key.addedAt}</p>
              </div>
              <Button variant="ghost" size="sm" className="text-destructive"><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Memory Keys</CardTitle>
            <CardDescription>Isolated memory contexts for different use cases.</CardDescription>
          </div>
          <Dialog open={newKeyOpen} onOpenChange={setNewKeyOpen}>
            <DialogTrigger asChild><Button size="sm"><Plus className="mr-1 h-3 w-3" />New Key</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Memory Key</DialogTitle>
                <DialogDescription>Create an isolated memory context.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Name (optional)</Label>
                  <Input placeholder="customer-support-bot" value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} />
                </div>
                <Separator />
                <div className="space-y-2">
                  <Label>Retention</Label>
                  <Select value={newKeyRetention} onValueChange={setNewKeyRetention}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {RETENTION_OPTIONS.map((opt) => (<SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setNewKeyOpen(false)}>Cancel</Button>
                <Button onClick={() => { setNewKeyOpen(false); setNewKeyName(""); }}>Create Key</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent className="space-y-3">
          {mockMemoryKeys.map((key) => (
            <div key={key.id} className="flex items-center justify-between rounded-md border px-4 py-3">
              <div className="space-y-1">
                <span className="font-medium text-sm">{key.name}</span>
                <p className="text-xs font-mono text-muted-foreground">{key.keyId}</p>
                <p className="text-xs text-muted-foreground">{formatTokens(key.tokens)} tokens - Last used {key.lastUsed}</p>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => copyToClipboard(key.keyId, key.id)}>
                  {copied === key.id ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem><Copy className="mr-2 h-4 w-4" />Copy Key ID</DropdownMenuItem>
                    <DropdownMenuItem><BarChart3 className="mr-2 h-4 w-4" />View Usage</DropdownMenuItem>
                    <DropdownMenuItem><Pencil className="mr-2 h-4 w-4" />Rename</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem><Eraser className="mr-2 h-4 w-4" />Clear Memory</DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive"><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>
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
