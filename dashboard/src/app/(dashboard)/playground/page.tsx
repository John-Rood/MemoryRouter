"use client";

import { useState, useEffect, useRef } from "react";
import { marked } from "marked";
import { ChevronDown, ChevronUp, Send, Plus, Trash2, RefreshCw, Settings2, X } from "lucide-react";
import { cn } from "@/lib/utils";

// Environment URLs
const ENVIRONMENTS = {
  production: "https://api.memoryrouter.ai",
  staging: "https://memoryrouter-staging.roodbiz.workers.dev",
};

interface Message {
  role: "user" | "assistant";
  content: string;
  latency?: {
    embedding_ms: number;
    mr_processing_ms: number;
    mr_overhead_ms: number;
    provider_ms: number;
  };
  debug?: {
    memory?: {
      tokens_retrieved?: number;
      chunks_retrieved?: number;
      chunks?: Array<{
        role: string;
        content: string;
        timestamp: number;
      }>;
      window_breakdown?: {
        hot: number;
        working: number;
        longterm: number;
      };
    };
    latency?: {
      mr_processing_ms?: number;
      provider_ms?: number;
    };
    augmented_messages?: unknown[];
  };
}

interface Chat {
  name: string;
  messages: Message[];
  createdAt: number;
}

interface MemoryKey {
  id: string;
  key: string;
  name: string;
  isActive: boolean;
}

export default function PlaygroundPage() {
  const [environment, setEnvironment] = useState<"production" | "staging">("production");
  const [memoryKeys, setMemoryKeys] = useState<MemoryKey[]>([]);
  const [selectedKeyId, setSelectedKeyId] = useState<string>("");
  const [isLoadingKeys, setIsLoadingKeys] = useState(true);
  const [model, setModel] = useState("");
  const [models, setModels] = useState<{ provider: string; models: string[] }[]>([]);
  const [defaultModel, setDefaultModel] = useState("openai/gpt-4o");
  const [memoryRetrieve, setMemoryRetrieve] = useState(true);
  const [memoryStore, setMemoryStore] = useState(true);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [chats, setChats] = useState<Record<string, Chat>>({});
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [messageInput, setMessageInput] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const getApiBase = () => ENVIRONMENTS[environment];
  const selectedKey = memoryKeys.find((k) => k.id === selectedKeyId);

  // Fetch memory keys
  useEffect(() => {
    async function fetchKeys() {
      try {
        const response = await fetch("/api/keys/memory");
        if (response.ok) {
          const data = await response.json();
          const keys = data.keys || [];
          setMemoryKeys(keys);
          // Pre-select first key if none selected
          const savedKeyId = localStorage.getItem("mr_debug_keyid");
          if (savedKeyId && keys.find((k: MemoryKey) => k.id === savedKeyId)) {
            setSelectedKeyId(savedKeyId);
          } else if (keys.length > 0) {
            setSelectedKeyId(keys[0].id);
          }
        }
      } catch (error) {
        console.error("Failed to fetch keys:", error);
      } finally {
        setIsLoadingKeys(false);
      }
    }
    fetchKeys();
  }, []);

  // Load config from localStorage
  useEffect(() => {
    const savedEnv = localStorage.getItem("mr_debug_env") as "production" | "staging" | null;
    const savedModel = localStorage.getItem("mr_debug_model");
    const savedChats = localStorage.getItem("mr_debug_chats");
    const savedSessionId = localStorage.getItem("mr_debug_sessionid");

    if (savedEnv) setEnvironment(savedEnv);
    if (savedModel) setModel(savedModel);
    if (savedSessionId) setSessionId(savedSessionId);

    if (savedChats) {
      try {
        const parsed = JSON.parse(savedChats);
        setChats(parsed);
        const firstChatId = Object.keys(parsed)[0];
        if (firstChatId) setActiveChatId(firstChatId);
      } catch {}
    }
  }, []);

  // Fetch models when key is selected
  useEffect(() => {
    if (selectedKey) {
      fetchModels(selectedKey.key, environment, model || null);
    }
  }, [selectedKey, environment]);

  // Save config on changes
  useEffect(() => {
    localStorage.setItem("mr_debug_env", environment);
    if (selectedKeyId) localStorage.setItem("mr_debug_keyid", selectedKeyId);
    if (model) localStorage.setItem("mr_debug_model", model);
    localStorage.setItem("mr_debug_chats", JSON.stringify(chats));
    if (sessionId) {
      localStorage.setItem("mr_debug_sessionid", sessionId);
    } else {
      localStorage.removeItem("mr_debug_sessionid");
    }
  }, [environment, selectedKeyId, model, chats, sessionId]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chats, activeChatId]);

  const fetchModels = async (key: string, env: "production" | "staging", selectedModel: string | null) => {
    try {
      const response = await fetch(`${ENVIRONMENTS[env]}/v1/models`, {
        headers: { Authorization: `Bearer ${key}` },
      });

      if (!response.ok) return;

      const data = await response.json();
      setModels(data.providers || []);
      setDefaultModel(data.default || "openai/gpt-4o");

      if (!selectedModel && data.default) {
        setModel(data.default);
      }
    } catch (error) {
      console.error("Failed to fetch models:", error);
    }
  };

  const uuid = () =>
    "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });

  const createChat = () => {
    const chatId = uuid();
    const newChats = {
      ...chats,
      [chatId]: {
        name: `Conversation ${Object.keys(chats).length + 1}`,
        messages: [],
        createdAt: Date.now(),
      },
    };
    setChats(newChats);
    setActiveChatId(chatId);
    setSettingsOpen(false);
  };

  const resetSession = () => {
    if (!confirm("Generate a new random session ID for an isolated vault?\n\nThis is useful for testing session isolation.")) return;
    const newSessionId = uuid();
    setSessionId(newSessionId);
    setChats({});
    setActiveChatId(null);
    setTimeout(createChat, 0);
  };

  const clearMemory = async () => {
    if (!selectedKey) {
      alert("Select a memory key first");
      return;
    }

    const vaultType = sessionId ? `session vault (${sessionId})` : "core vault";
    if (!confirm(`⚠️ This will DELETE all memories from the ${vaultType}.\n\nThis cannot be undone.\n\nAre you sure?`)) return;

    try {
      const headers: Record<string, string> = { Authorization: `Bearer ${selectedKey.key}` };
      if (sessionId) headers["X-Session-ID"] = sessionId;

      const response = await fetch(`${getApiBase()}/v1/memory`, {
        method: "DELETE",
        headers,
      });

      const data = await response.json();

      if (response.ok) {
        setChats({});
        setActiveChatId(null);
        setTimeout(createChat, 0);
        alert(`✅ ${vaultType} cleared. Fresh start!`);
      } else {
        alert("Error: " + (data.error || "Failed to clear memory"));
      }
    } catch (error) {
      alert("Network error: " + (error instanceof Error ? error.message : "Unknown error"));
    }
  };

  const sendMessage = async () => {
    if (!selectedKey) {
      alert("Please select a memory key");
      return;
    }
    if (!model) {
      alert("Please select a model");
      return;
    }
    if (!messageInput.trim()) return;

    let currentChatId = activeChatId;
    let currentChats = chats;

    if (!currentChatId) {
      const chatId = uuid();
      currentChats = {
        ...chats,
        [chatId]: {
          name: `Conversation ${Object.keys(chats).length + 1}`,
          messages: [],
          createdAt: Date.now(),
        },
      };
      currentChatId = chatId;
      setChats(currentChats);
      setActiveChatId(chatId);
    }

    const userMessage: Message = { role: "user", content: messageInput.trim() };
    const updatedChats = {
      ...currentChats,
      [currentChatId]: {
        ...currentChats[currentChatId],
        messages: [...currentChats[currentChatId].messages, userMessage],
      },
    };
    setChats(updatedChats);
    setMessageInput("");
    setIsLoading(true);

    const apiMessages = updatedChats[currentChatId].messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    try {
      let memoryMode = "auto";
      if (!memoryRetrieve && !memoryStore) memoryMode = "off";
      else if (!memoryRetrieve && memoryStore) memoryMode = "write";
      else if (memoryRetrieve && !memoryStore) memoryMode = "read";

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${selectedKey.key}`,
        "X-Memory-Mode": memoryMode,
        "X-Memory-Store": String(memoryStore),
        "X-Memory-Store-Response": String(memoryStore),
      };
      if (sessionId) headers["X-Session-ID"] = sessionId;

      const response = await fetch(`${getApiBase()}/v1/chat/completions?debug=true&mode=${memoryMode}`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          messages: apiMessages,
          stream: false,
        }),
      });

      const data = await response.json();
      let assistantMessage: Message;

      if (!response.ok) {
        assistantMessage = {
          role: "assistant",
          content: `Error: ${data.error || "Request failed"}`,
        };
      } else {
        const assistantContent = data.choices?.[0]?.message?.content || "No response";
        assistantMessage = {
          role: "assistant",
          content: assistantContent,
          latency: data._latency,
          debug: {
            memory: data._memory,
            latency: data._latency,
            augmented_messages: data._debug?.augmented_messages,
          },
        };
      }

      setChats((prev) => ({
        ...prev,
        [currentChatId!]: {
          ...prev[currentChatId!],
          messages: [...prev[currentChatId!].messages, assistantMessage],
        },
      }));
    } catch (error) {
      setChats((prev) => ({
        ...prev,
        [currentChatId!]: {
          ...prev[currentChatId!],
          messages: [
            ...prev[currentChatId!].messages,
            {
              role: "assistant",
              content: `Network error: ${error instanceof Error ? error.message : "Unknown error"}`,
            },
          ],
        },
      }));
    } finally {
      setIsLoading(false);
    }
  };

  const activeChat = activeChatId ? chats[activeChatId] : null;
  const sortedChats = Object.entries(chats).sort((a, b) => b[1].createdAt - a[1].createdAt);

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] lg:h-screen -mx-4 lg:-mx-8 -my-6 lg:-my-8">
      {/* Mobile Settings Toggle */}
      <div className="lg:hidden border-b border-white/[0.04] bg-background/95 backdrop-blur-xl">
        <button
          onClick={() => setSettingsOpen(!settingsOpen)}
          className="flex items-center justify-between w-full px-4 py-3 text-sm font-medium"
        >
          <div className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-muted-foreground" />
            <span>Settings</span>
            <span className="text-xs text-muted-foreground">
              {environment === "staging" ? "🟡 Staging" : "🟢 Production"}
            </span>
          </div>
          {settingsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>

        {/* Mobile Settings Panel */}
        {settingsOpen && (
          <div className="px-4 pb-4 space-y-4 border-t border-white/[0.04]">
            <SettingsPanel
              environment={environment}
              setEnvironment={setEnvironment}
              memoryKeys={memoryKeys}
              selectedKeyId={selectedKeyId}
              setSelectedKeyId={setSelectedKeyId}
              isLoadingKeys={isLoadingKeys}
              model={model}
              setModel={setModel}
              models={models}
              defaultModel={defaultModel}
              memoryRetrieve={memoryRetrieve}
              setMemoryRetrieve={setMemoryRetrieve}
              memoryStore={memoryStore}
              setMemoryStore={setMemoryStore}
              sessionId={sessionId}
              setSessionId={setSessionId}
            />

            {/* Chat List - Mobile */}
            <ChatList chats={sortedChats} activeChatId={activeChatId} onSelect={(id) => { setActiveChatId(id); setSettingsOpen(false); }} />

            {/* Actions - Mobile */}
            <div className="space-y-2 pt-2 border-t border-white/[0.04]">
              <button onClick={createChat} className="w-full btn-neon py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2">
                <Plus className="h-4 w-4" />
                New Conversation
              </button>
              <button
                onClick={resetSession}
                className="w-full py-2.5 rounded-lg text-sm font-medium border border-white/[0.04] text-muted-foreground hover:text-foreground hover:border-white/10 transition-colors flex items-center justify-center gap-2"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                New Session ID
              </button>
              <button
                onClick={clearMemory}
                className="w-full py-2.5 rounded-lg text-sm font-medium border border-white/[0.04] text-muted-foreground hover:text-destructive hover:border-destructive/30 transition-colors flex items-center justify-center gap-2"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear Memory Vault
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Desktop Sidebar */}
        <aside className="hidden lg:flex w-72 flex-col border-r border-white/[0.04] bg-background/50 overflow-hidden">
          <div className="p-4 border-b border-white/[0.04]">
            <h1 className="text-lg font-semibold">
              Playground <span className="text-xs text-muted-foreground ml-2">{environment === "staging" ? "🟡 Staging" : "🟢 Production"}</span>
            </h1>
            <p className="text-xs text-muted-foreground mt-1">Test your memory keys</p>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <SettingsPanel
              environment={environment}
              setEnvironment={setEnvironment}
              memoryKeys={memoryKeys}
              selectedKeyId={selectedKeyId}
              setSelectedKeyId={setSelectedKeyId}
              isLoadingKeys={isLoadingKeys}
              model={model}
              setModel={setModel}
              models={models}
              defaultModel={defaultModel}
              memoryRetrieve={memoryRetrieve}
              setMemoryRetrieve={setMemoryRetrieve}
              memoryStore={memoryStore}
              setMemoryStore={setMemoryStore}
              sessionId={sessionId}
              setSessionId={setSessionId}
            />

            {/* Chat List - Desktop */}
            <div className="pt-4 border-t border-white/[0.04]">
              <ChatList chats={sortedChats} activeChatId={activeChatId} onSelect={setActiveChatId} />
            </div>
          </div>

          {/* Actions - anchored to bottom */}
          <div className="p-4 border-t border-white/[0.04] space-y-2">
            <button onClick={createChat} className="w-full btn-neon py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2">
              <Plus className="h-4 w-4" />
              New Conversation
            </button>
            <button
              onClick={resetSession}
              className="w-full py-2.5 rounded-lg text-sm font-medium border border-white/[0.04] text-muted-foreground hover:text-foreground hover:border-white/10 transition-colors flex items-center justify-center gap-2"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              New Session ID
            </button>
            <button
              onClick={clearMemory}
              className="w-full py-2.5 rounded-lg text-sm font-medium border border-white/[0.04] text-muted-foreground hover:text-destructive hover:border-destructive/30 transition-colors flex items-center justify-center gap-2"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear Memory Vault
            </button>
          </div>
        </aside>

        {/* Main Chat Area */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Chat Header */}
          <header className="px-4 py-3 border-b border-white/[0.04] bg-background/80 backdrop-blur-xl">
            <h2 className="font-medium">{activeChat?.name || "New Chat"}</h2>
            <p className="text-xs text-muted-foreground font-mono">
              vault: {sessionId ? `session (${sessionId.slice(0, 8)}...)` : "core (main)"}
            </p>
          </header>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-6">
            {!activeChat || activeChat.messages.length === 0 ? (
              <div className="text-center text-muted-foreground py-12 px-4">
                <p className="font-medium mb-2">🧪 Context Loss Simulation</p>
                <p className="text-sm leading-relaxed max-w-md mx-auto">
                  This conversation has no history (like a fresh chat window).
                  If you&apos;ve chatted before, memory should inject relevant context.
                  <br /><br />
                  <strong>Test it:</strong> Chat about something, then create a new conversation
                  and ask about the same topic — memory should bridge the gap.
                </p>
              </div>
            ) : (
              activeChat.messages.map((msg, idx) => (
                <MessageBubble key={idx} message={msg} />
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="p-4 border-t border-white/[0.04] bg-background">
            <div className="flex gap-3 max-w-4xl mx-auto">
              <textarea
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (!isLoading) sendMessage();
                  }
                }}
                placeholder="Type a message..."
                rows={2}
                className="flex-1 resize-none rounded-xl bg-card border border-white/[0.04] px-4 py-3 text-sm outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
              />
              <button
                onClick={sendMessage}
                disabled={isLoading || !messageInput.trim()}
                className="btn-neon px-6 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

// Settings Panel Component
function SettingsPanel({
  environment,
  setEnvironment,
  memoryKeys,
  selectedKeyId,
  setSelectedKeyId,
  isLoadingKeys,
  model,
  setModel,
  models,
  defaultModel,
  memoryRetrieve,
  setMemoryRetrieve,
  memoryStore,
  setMemoryStore,
  sessionId,
  setSessionId,
}: {
  environment: "production" | "staging";
  setEnvironment: (e: "production" | "staging") => void;
  memoryKeys: MemoryKey[];
  selectedKeyId: string;
  setSelectedKeyId: (id: string) => void;
  isLoadingKeys: boolean;
  model: string;
  setModel: (m: string) => void;
  models: { provider: string; models: string[] }[];
  defaultModel: string;
  memoryRetrieve: boolean;
  setMemoryRetrieve: (v: boolean) => void;
  memoryStore: boolean;
  setMemoryStore: (v: boolean) => void;
  sessionId: string | null;
  setSessionId: (s: string | null) => void;
}) {
  return (
    <div className="space-y-4">
      {/* Environment */}
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Environment</label>
        <select
          value={environment}
          onChange={(e) => setEnvironment(e.target.value as "production" | "staging")}
          className="w-full bg-card border border-white/[0.04] rounded-lg px-3 py-2.5 text-sm outline-none focus:border-primary/50 font-mono"
        >
          <option value="production">🟢 Production</option>
          <option value="staging">🟡 Staging</option>
        </select>
      </div>

      {/* Memory Key Dropdown */}
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Memory Key</label>
        {isLoadingKeys ? (
          <div className="w-full bg-card border border-white/[0.04] rounded-lg px-3 py-2.5 text-sm text-muted-foreground">
            Loading keys...
          </div>
        ) : memoryKeys.length === 0 ? (
          <div className="w-full bg-card border border-white/[0.04] rounded-lg px-3 py-2.5 text-sm text-muted-foreground">
            No keys found
          </div>
        ) : (
          <select
            value={selectedKeyId}
            onChange={(e) => setSelectedKeyId(e.target.value)}
            className="w-full bg-card border border-white/[0.04] rounded-lg px-3 py-2.5 text-sm outline-none focus:border-primary/50"
          >
            {memoryKeys.map((key) => (
              <option key={key.id} value={key.id}>
                {key.name || "Untitled"} ({key.key.slice(0, 10)}...)
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Model */}
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Model</label>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="w-full bg-card border border-white/[0.04] rounded-lg px-3 py-2.5 text-sm outline-none focus:border-primary/50 font-mono"
        >
          {models.length > 0 ? (
            models.map((provider) => (
              <optgroup key={provider.provider} label={provider.provider}>
                {provider.models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </optgroup>
            ))
          ) : (
            <option value={defaultModel}>{defaultModel}</option>
          )}
        </select>
      </div>

      {/* Memory Toggles */}
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Memory Settings</label>
        <div className="space-y-2">
          <ToggleRow label="Retrieve memories" checked={memoryRetrieve} onChange={setMemoryRetrieve} />
          <ToggleRow label="Store this conversation" checked={memoryStore} onChange={setMemoryStore} />
        </div>
      </div>

      {/* Session ID */}
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground uppercase tracking-wider font-medium">
          Session ID <span className="normal-case font-normal">(blank = core vault)</span>
        </label>
        <input
          type="text"
          value={sessionId || ""}
          onChange={(e) => setSessionId(e.target.value.trim() || null)}
          placeholder="Leave empty for core vault"
          className="w-full bg-card border border-white/[0.04] rounded-lg px-3 py-2.5 text-sm outline-none focus:border-primary/50 font-mono"
        />
        <p className="text-xs text-muted-foreground">Each session ID creates an isolated memory vault</p>
      </div>
    </div>
  );
}

// Toggle Row Component
function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer text-sm text-muted-foreground hover:text-foreground transition-colors">
      <div
        className={cn(
          "relative w-9 h-5 rounded-full transition-colors",
          checked ? "bg-primary/20 border border-primary/50" : "bg-card border border-white/[0.04]"
        )}
        onClick={() => onChange(!checked)}
      >
        <div
          className={cn(
            "absolute top-0.5 w-4 h-4 rounded-full transition-all",
            checked ? "left-4 bg-primary shadow-[0_0_8px_rgba(57,255,20,0.5)]" : "left-0.5 bg-muted-foreground"
          )}
        />
      </div>
      <span>{label}</span>
    </label>
  );
}

// Chat List Component
function ChatList({
  chats,
  activeChatId,
  onSelect,
}: {
  chats: [string, Chat][];
  activeChatId: string | null;
  onSelect: (id: string) => void;
}) {
  if (chats.length === 0) return null;

  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-2">Conversations</p>
      {chats.map(([id, chat]) => (
        <button
          key={id}
          onClick={() => onSelect(id)}
          className={cn(
            "w-full text-left px-3 py-2.5 rounded-lg text-sm transition-all",
            id === activeChatId
              ? "bg-primary/10 border border-primary/20 text-foreground"
              : "hover:bg-card border border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <p className="font-medium truncate">{chat.name}</p>
          <p className="text-xs text-muted-foreground">{chat.messages.length} messages</p>
        </button>
      ))}
    </div>
  );
}

// Message Bubble Component
function MessageBubble({ message }: { message: Message }) {
  const [debugOpen, setDebugOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"stats" | "prompt" | "chunks">("stats");

  const isUser = message.role === "user";

  return (
    <div className={cn("max-w-4xl", isUser ? "ml-auto" : "")}>
      {/* Role badge & latency */}
      <div className="flex items-center gap-2 mb-2">
        <span
          className={cn(
            "text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded",
            isUser ? "bg-accent/15 text-accent" : "bg-primary/15 text-primary"
          )}
        >
          {message.role}
        </span>
        {message.latency && (
          <span className="text-xs text-muted-foreground font-mono">
            Embed: {message.latency.embedding_ms}ms · MR: {message.latency.mr_processing_ms}ms · Provider: {message.latency.provider_ms}ms
          </span>
        )}
      </div>

      {/* Content */}
      <div
        className={cn(
          "glass-card rounded-xl px-4 py-3 text-sm leading-relaxed",
          isUser ? "border-accent/10" : "border-primary/10"
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div
            className="prose prose-invert prose-sm max-w-none prose-pre:bg-[#0f0f13] prose-pre:border prose-pre:border-white/[0.04] prose-code:text-primary prose-code:before:content-none prose-code:after:content-none"
            dangerouslySetInnerHTML={{ __html: marked.parse(message.content) as string }}
          />
        )}
      </div>

      {/* Debug Panel */}
      {message.debug && (
        <div className="mt-3">
          <button
            onClick={() => setDebugOpen(!debugOpen)}
            className="flex items-center justify-between w-full px-4 py-2.5 rounded-lg text-xs text-muted-foreground hover:text-foreground glass-card transition-colors"
          >
            <span>🔍 Debug Info</span>
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", debugOpen && "rotate-180")} />
          </button>

          {debugOpen && (
            <div className="mt-2 glass-card rounded-xl overflow-hidden">
              {/* Tabs */}
              <div className="flex border-b border-white/[0.04] bg-card/50">
                {(["stats", "prompt", "chunks"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={cn(
                      "px-4 py-3 text-xs font-medium capitalize transition-colors border-b-2",
                      activeTab === tab
                        ? "text-primary border-primary"
                        : "text-muted-foreground border-transparent hover:text-foreground"
                    )}
                  >
                    {tab === "stats" ? "Memory Stats" : tab === "prompt" ? "Full Prompt" : "Retrieved Chunks"}
                  </button>
                ))}
              </div>

              {/* Tab Content */}
              <div className="p-4 max-h-96 overflow-y-auto">
                {activeTab === "stats" && <MemoryStatsTab memory={message.debug.memory} latency={message.debug.latency} />}
                {activeTab === "prompt" && (
                  <pre className="text-xs font-mono whitespace-pre-wrap break-all p-4 rounded-lg bg-[#0f0f13] border border-white/[0.04]">
                    {JSON.stringify(message.debug.augmented_messages || [], null, 2)}
                  </pre>
                )}
                {activeTab === "chunks" && <ChunksTab chunks={message.debug.memory?.chunks} />}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Memory Stats Tab
function MemoryStatsTab({ memory, latency }: { 
  memory?: {
    tokens_retrieved?: number;
    chunks_retrieved?: number;
    chunks?: Array<{ role: string; content: string; timestamp: number }>;
    window_breakdown?: { hot: number; working: number; longterm: number };
  }; 
  latency?: { mr_processing_ms?: number; provider_ms?: number } 
}) {
  const windowBreakdown = memory?.window_breakdown || { hot: 0, working: 0, longterm: 0 };
  const totalChunks = windowBreakdown.hot + windowBreakdown.working + windowBreakdown.longterm;

  const hotPct = totalChunks ? (windowBreakdown.hot / totalChunks) * 100 : 0;
  const workingPct = totalChunks ? (windowBreakdown.working / totalChunks) * 100 : 0;
  const longtermPct = totalChunks ? (windowBreakdown.longterm / totalChunks) * 100 : 0;

  return (
    <div className="space-y-4">
      {/* Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Tokens Retrieved" value={memory?.tokens_retrieved || 0} />
        <StatCard label="Chunks" value={memory?.chunks_retrieved || 0} />
        <StatCard label="MR Latency" value={latency?.mr_processing_ms || 0} unit="ms" />
        <StatCard label="Provider" value={latency?.provider_ms || 0} unit="ms" />
      </div>

      {/* KRONOS Bar */}
      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-2">KRONOS Time Windows</p>
        {totalChunks > 0 ? (
          <>
            <div className="flex h-7 rounded-md overflow-hidden border border-white/[0.04]">
              {hotPct > 0 && (
                <div className="flex items-center justify-center text-xs font-semibold text-black bg-gradient-to-r from-[#ff006e] to-[#ff4d94]" style={{ width: `${hotPct}%` }}>
                  {windowBreakdown.hot}
                </div>
              )}
              {workingPct > 0 && (
                <div className="flex items-center justify-center text-xs font-semibold text-black bg-gradient-to-r from-[#00d4ff] to-[#4de1ff]" style={{ width: `${workingPct}%` }}>
                  {windowBreakdown.working}
                </div>
              )}
              {longtermPct > 0 && (
                <div className="flex items-center justify-center text-xs font-semibold text-black bg-gradient-to-r from-[#8338ec] to-[#a66eff]" style={{ width: `${longtermPct}%` }}>
                  {windowBreakdown.longterm}
                </div>
              )}
            </div>
            <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-[#ff006e]" />
                Hot ({windowBreakdown.hot})
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-[#00d4ff]" />
                Working ({windowBreakdown.working})
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-[#8338ec]" />
                Long-term ({windowBreakdown.longterm})
              </span>
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">No memory retrieved yet</p>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, unit }: { label: string; value: number; unit?: string }) {
  return (
    <div className="stat-card rounded-lg px-3 py-3">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium mb-1">{label}</p>
      <p className="text-xl font-semibold text-primary font-mono">
        {value}
        {unit && <span className="text-xs text-muted-foreground font-normal ml-0.5">{unit}</span>}
      </p>
    </div>
  );
}

// Chunks Tab
function ChunksTab({ chunks }: { chunks?: Array<{ role: string; content: string; timestamp: number }> }) {
  if (!chunks || chunks.length === 0) {
    return <p className="text-xs text-muted-foreground">No chunks retrieved</p>;
  }

  const formatRelativeTime = (timestamp: number) => {
    const delta = Date.now() - timestamp;
    const minutes = Math.floor(delta / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const weeks = Math.floor(days / 7);
    const months = Math.floor(days / 30);

    if (months > 0) return `${months} month${months > 1 ? "s" : ""} ago`;
    if (weeks > 0) return `${weeks} week${weeks > 1 ? "s" : ""} ago`;
    if (days > 0) return `${days} day${days > 1 ? "s" : ""} ago`;
    if (hours > 0) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
    if (minutes > 0) return `${minutes} min ago`;
    return "just now";
  };

  return (
    <div className="space-y-3">
      {chunks.map((chunk, i) => (
        <div key={i} className="p-3 rounded-lg bg-[#0f0f13] border border-white/[0.04]">
          <div className="flex items-center gap-2 mb-2 text-xs">
            <span className="font-semibold text-muted-foreground">[{i + 1}]</span>
            <span className={cn("uppercase font-medium", chunk.role === "user" ? "text-accent" : "text-primary")}>{chunk.role}</span>
            <span className="text-muted-foreground">— {formatRelativeTime(chunk.timestamp)}</span>
          </div>
          <p className="text-xs font-mono whitespace-pre-wrap text-foreground/80">&quot;{chunk.content}&quot;</p>
        </div>
      ))}
    </div>
  );
}
