"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Copy, Trash2, Key, Check, Eye, EyeOff, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { PROVIDERS } from "@/lib/constants";

interface MemoryKey {
  id: string;
  key: string;
  name: string;
  isActive: boolean;
  tokensStored?: number;
  tokensRetrieved?: number;
  requestCount?: number;
  lastUsedAt?: string;
  createdAt: string;
}

interface ProviderKey {
  id: string;
  provider: string;
  keyHint: string;
  nickname?: string;
  isActive: boolean;
  lastVerifiedAt?: string;
  createdAt: string;
}

export default function KeysPage() {
  const [memoryKeys, setMemoryKeys] = useState<MemoryKey[]>([]);
  const [providerKeys, setProviderKeys] = useState<ProviderKey[]>([]);
  const [isLoadingMemory, setIsLoadingMemory] = useState(true);
  const [isLoadingProvider, setIsLoadingProvider] = useState(true);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [newKeyName, setNewKeyName] = useState("");
  const [newProvider, setNewProvider] = useState("");
  const [newProviderKey, setNewProviderKey] = useState("");
  const [showProviderKey, setShowProviderKey] = useState(false);
  const [isCreatingMemoryKey, setIsCreatingMemoryKey] = useState(false);
  const [isAddingProviderKey, setIsAddingProviderKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Fetch memory keys
  const fetchMemoryKeys = useCallback(async () => {
    try {
      const response = await fetch("/api/keys/memory");
      if (response.ok) {
        const data = await response.json();
        setMemoryKeys(data.keys || []);
      }
    } catch (error) {
      console.error("Failed to fetch memory keys:", error);
    } finally {
      setIsLoadingMemory(false);
    }
  }, []);

  // Fetch provider keys
  const fetchProviderKeys = useCallback(async () => {
    try {
      const response = await fetch("/api/keys/provider");
      if (response.ok) {
        const data = await response.json();
        setProviderKeys(data.keys || []);
      }
    } catch (error) {
      console.error("Failed to fetch provider keys:", error);
    } finally {
      setIsLoadingProvider(false);
    }
  }, []);

  useEffect(() => {
    fetchMemoryKeys();
    fetchProviderKeys();
  }, [fetchMemoryKeys, fetchProviderKeys]);

  const copyToClipboard = (key: string) => {
    navigator.clipboard.writeText(key);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const createMemoryKey = async () => {
    setIsSaving(true);
    try {
      const response = await fetch("/api/keys/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKeyName || "Untitled" }),
      });
      
      if (response.ok) {
        const data = await response.json();
        setMemoryKeys([data.key, ...memoryKeys]);
        setNewKeyName("");
        setIsCreatingMemoryKey(false);
      }
    } catch (error) {
      console.error("Failed to create memory key:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const deleteMemoryKey = async (id: string) => {
    try {
      const response = await fetch(`/api/keys/memory?id=${id}`, {
        method: "DELETE",
      });
      
      if (response.ok) {
        setMemoryKeys(memoryKeys.filter(k => k.id !== id));
      }
    } catch (error) {
      console.error("Failed to delete memory key:", error);
    }
  };

  const addProviderKey = async () => {
    setIsSaving(true);
    try {
      const response = await fetch("/api/keys/provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          provider: newProvider, 
          apiKey: newProviderKey,
        }),
      });
      
      if (response.ok) {
        const data = await response.json();
        // Add to list with the hint from server
        setProviderKeys([...providerKeys, {
          id: Date.now().toString(),
          provider: data.provider,
          keyHint: data.keyHint,
          isActive: true,
          createdAt: new Date().toISOString(),
        }]);
        setNewProvider("");
        setNewProviderKey("");
        setIsAddingProviderKey(false);
      }
    } catch (error) {
      console.error("Failed to add provider key:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const deleteProviderKey = async (provider: string) => {
    try {
      const response = await fetch(`/api/keys/provider?provider=${provider}`, {
        method: "DELETE",
      });
      
      if (response.ok) {
        setProviderKeys(providerKeys.filter(k => k.provider !== provider));
      }
    } catch (error) {
      console.error("Failed to delete provider key:", error);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
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
            <div className="flex gap-2">
              <Button variant="ghost" size="icon" onClick={fetchMemoryKeys} disabled={isLoadingMemory}>
                <RefreshCw className={`h-4 w-4 ${isLoadingMemory ? 'animate-spin' : ''}`} />
              </Button>
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
                    <Button className="btn-neon" onClick={createMemoryKey} disabled={isSaving}>
                      {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      Create
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          {isLoadingMemory ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <div className="grid gap-4">
              {memoryKeys.map((key) => (
                <Card key={key.id} className="glass-card border-border/10 hover:border-primary/20 transition-colors">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Key className="h-4 w-4 text-primary" />
                          <span className="font-medium">{key.name || "Untitled"}</span>
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
                          Created {formatDate(key.createdAt)}
                          {key.requestCount ? ` • ${key.requestCount.toLocaleString()} requests` : ''}
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
                <Card className="glass-card border-border/10">
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
          )}
        </TabsContent>

        {/* Provider Keys Tab */}
        <TabsContent value="provider" className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Add your AI provider API keys (encrypted at rest)
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" size="icon" onClick={fetchProviderKeys} disabled={isLoadingProvider}>
                <RefreshCw className={`h-4 w-4 ${isLoadingProvider ? 'animate-spin' : ''}`} />
              </Button>
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
                          {PROVIDERS.map((p) => (
                            <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
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
                          placeholder={PROVIDERS.find(p => p.id === newProvider)?.placeholder || "Enter your API key"}
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
                      {newProvider && (
                        <p className="text-xs text-muted-foreground">
                          {PROVIDERS.find(p => p.id === newProvider)?.formatHint}
                          {" · "}
                          <a
                            href={PROVIDERS.find(p => p.id === newProvider)?.apiKeyUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline inline-flex items-center gap-1"
                          >
                            Get a key
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </p>
                      )}
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="ghost" onClick={() => setIsAddingProviderKey(false)}>Cancel</Button>
                    <Button className="btn-neon" onClick={addProviderKey} disabled={!newProvider || !newProviderKey || isSaving}>
                      {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      Add Key
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          {isLoadingProvider ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <div className="grid gap-4">
              {providerKeys.map((key) => (
                <Card key={key.id} className="glass-card border-border/10 hover:border-primary/20 transition-colors">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium capitalize">{key.provider}</span>
                          {key.isActive && (
                            <Badge variant="outline" className="text-xs border-primary/30 text-primary">Active</Badge>
                          )}
                        </div>
                        <code className="text-sm text-muted-foreground font-mono">{key.keyHint}</code>
                        <p className="text-xs text-muted-foreground">Added {formatDate(key.createdAt)}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => deleteProviderKey(key.provider)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}

              {providerKeys.length === 0 && (
                <Card className="glass-card border-border/10">
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
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
