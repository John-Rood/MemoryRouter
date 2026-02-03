"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Copy, Trash2, Key, Check, Eye, EyeOff } from "lucide-react";

// Mock data for MVP
const mockMemoryKeys = [
  { id: "1", key: "mk_abc123def456ghi789jkl", name: "Production App", createdAt: "2026-01-15", requestCount: 456, isActive: true },
  { id: "2", key: "mk_xyz789uvw456rst123opq", name: "Development", createdAt: "2026-01-20", requestCount: 123, isActive: true },
  { id: "3", key: "mk_demo123test456key789", name: "Testing", createdAt: "2026-02-01", requestCount: 12, isActive: true },
];

const mockProviderKeys = [
  { id: "1", provider: "openai", keyHint: "sk-proj••••xxxx", createdAt: "2026-01-15", isDefault: true },
  { id: "2", provider: "anthropic", keyHint: "sk-ant-••••yyyy", createdAt: "2026-01-20", isDefault: false },
];

const providers = [
  { value: "openai", label: "OpenAI", placeholder: "sk-proj-..." },
  { value: "anthropic", label: "Anthropic", placeholder: "sk-ant-..." },
  { value: "google", label: "Google AI", placeholder: "AIza..." },
  { value: "openrouter", label: "OpenRouter", placeholder: "sk-or-..." },
];

export default function KeysPage() {
  const [memoryKeys, setMemoryKeys] = useState(mockMemoryKeys);
  const [providerKeys, setProviderKeys] = useState(mockProviderKeys);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [newKeyName, setNewKeyName] = useState("");
  const [newProvider, setNewProvider] = useState("");
  const [newProviderKey, setNewProviderKey] = useState("");
  const [showProviderKey, setShowProviderKey] = useState(false);
  const [isCreatingMemoryKey, setIsCreatingMemoryKey] = useState(false);
  const [isAddingProviderKey, setIsAddingProviderKey] = useState(false);
  
  const copyToClipboard = (key: string) => {
    navigator.clipboard.writeText(key);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };
  
  const createMemoryKey = () => {
    const newKey = {
      id: Date.now().toString(),
      key: `mk_${Math.random().toString(36).substring(2, 26)}`,
      name: newKeyName || "Untitled",
      createdAt: new Date().toISOString().split('T')[0],
      requestCount: 0,
      isActive: true,
    };
    setMemoryKeys([newKey, ...memoryKeys]);
    setNewKeyName("");
    setIsCreatingMemoryKey(false);
  };
  
  const deleteMemoryKey = (id: string) => {
    setMemoryKeys(memoryKeys.filter(k => k.id !== id));
  };
  
  const addProviderKey = () => {
    const provider = providers.find(p => p.value === newProvider);
    const newKey = {
      id: Date.now().toString(),
      provider: newProvider,
      keyHint: newProviderKey.slice(0, 7) + "••••" + newProviderKey.slice(-4),
      createdAt: new Date().toISOString().split('T')[0],
      isDefault: providerKeys.length === 0,
    };
    setProviderKeys([...providerKeys, newKey]);
    setNewProvider("");
    setNewProviderKey("");
    setIsAddingProviderKey(false);
  };
  
  const deleteProviderKey = (id: string) => {
    setProviderKeys(providerKeys.filter(k => k.id !== id));
  };
  
  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold gradient-text">API Keys</h1>
        <p className="text-muted-foreground mt-1">
          Manage your memory keys and provider API keys
        </p>
      </div>
      
      <Tabs defaultValue="memory" className="space-y-6">
        <TabsList className="bg-muted/50">
          <TabsTrigger value="memory" className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary">
            Memory Keys
          </TabsTrigger>
          <TabsTrigger value="provider" className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary">
            Provider Keys
          </TabsTrigger>
        </TabsList>
        
        {/* Memory Keys Tab */}
        <TabsContent value="memory" className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Each memory key represents an isolated memory context
            </p>
            <Dialog open={isCreatingMemoryKey} onOpenChange={setIsCreatingMemoryKey}>
              <DialogTrigger asChild>
                <Button className="btn-neon">
                  <Plus className="h-4 w-4 mr-2" />
                  Create Key
                </Button>
              </DialogTrigger>
              <DialogContent className="glass-card">
                <DialogHeader>
                  <DialogTitle>Create Memory Key</DialogTitle>
                  <DialogDescription>
                    Create a new isolated memory context for your application.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Name (optional)</Label>
                    <Input 
                      id="name" 
                      placeholder="e.g., Production, User-123, Project-X"
                      value={newKeyName}
                      onChange={(e) => setNewKeyName(e.target.value)}
                      className="bg-muted/50"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setIsCreatingMemoryKey(false)}>Cancel</Button>
                  <Button className="btn-neon" onClick={createMemoryKey}>Create</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          
          <div className="grid gap-4">
            {memoryKeys.map((key) => (
              <Card key={key.id} className="glass-card border-border/50 hover:border-primary/20 transition-colors">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Key className="h-4 w-4 text-primary" />
                        <span className="font-medium">{key.name}</span>
                        {key.isActive && (
                          <Badge variant="outline" className="text-xs border-primary/30 text-primary">Active</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <code className="text-sm text-muted-foreground font-mono bg-muted/50 px-2 py-1 rounded">
                          {key.key}
                        </code>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8"
                          onClick={() => copyToClipboard(key.key)}
                        >
                          {copiedKey === key.key ? (
                            <Check className="h-4 w-4 text-primary" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Created {key.createdAt} • {key.requestCount} requests
                      </p>
                    </div>
                    <Button 
                      variant="ghost" 
                      size="icon"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => deleteMemoryKey(key.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
            
            {memoryKeys.length === 0 && (
              <Card className="glass-card border-border/50">
                <CardContent className="p-8 text-center">
                  <Key className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                  <h3 className="font-medium mb-2">No memory keys yet</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Create your first memory key to start building with persistent AI memory.
                  </p>
                  <Button className="btn-neon" onClick={() => setIsCreatingMemoryKey(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Create Your First Key
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>
        
        {/* Provider Keys Tab */}
        <TabsContent value="provider" className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Add your AI provider API keys (encrypted at rest)
            </p>
            <Dialog open={isAddingProviderKey} onOpenChange={setIsAddingProviderKey}>
              <DialogTrigger asChild>
                <Button className="btn-neon">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Provider Key
                </Button>
              </DialogTrigger>
              <DialogContent className="glass-card">
                <DialogHeader>
                  <DialogTitle>Add Provider Key</DialogTitle>
                  <DialogDescription>
                    Add your AI provider API key. It will be encrypted and stored securely.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="provider">Provider</Label>
                    <Select value={newProvider} onValueChange={setNewProvider}>
                      <SelectTrigger className="bg-muted/50">
                        <SelectValue placeholder="Select a provider" />
                      </SelectTrigger>
                      <SelectContent>
                        {providers.map((p) => (
                          <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="apiKey">API Key</Label>
                    <div className="relative">
                      <Input 
                        id="apiKey" 
                        type={showProviderKey ? "text" : "password"}
                        placeholder={providers.find(p => p.value === newProvider)?.placeholder || "Enter your API key"}
                        value={newProviderKey}
                        onChange={(e) => setNewProviderKey(e.target.value)}
                        className="bg-muted/50 pr-10"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-0 top-0 h-full px-3"
                        onClick={() => setShowProviderKey(!showProviderKey)}
                      >
                        {showProviderKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setIsAddingProviderKey(false)}>Cancel</Button>
                  <Button className="btn-neon" onClick={addProviderKey} disabled={!newProvider || !newProviderKey}>
                    Add Key
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          
          <div className="grid gap-4">
            {providerKeys.map((key) => (
              <Card key={key.id} className="glass-card border-border/50 hover:border-primary/20 transition-colors">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium capitalize">{key.provider}</span>
                        {key.isDefault && (
                          <Badge variant="outline" className="text-xs border-primary/30 text-primary">Default</Badge>
                        )}
                      </div>
                      <code className="text-sm text-muted-foreground font-mono">{key.keyHint}</code>
                      <p className="text-xs text-muted-foreground">Added {key.createdAt}</p>
                    </div>
                    <Button 
                      variant="ghost" 
                      size="icon"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => deleteProviderKey(key.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
            
            {providerKeys.length === 0 && (
              <Card className="glass-card border-border/50">
                <CardContent className="p-8 text-center">
                  <Key className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                  <h3 className="font-medium mb-2">No provider keys yet</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Add your AI provider API keys to start using MemoryRouter.
                  </p>
                  <Button className="btn-neon" onClick={() => setIsAddingProviderKey(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Your First Provider Key
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
