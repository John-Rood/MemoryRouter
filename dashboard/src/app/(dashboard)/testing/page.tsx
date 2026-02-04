"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Send, Zap, Key } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
  mrTime?: number;
  totalTime?: number;
  isError?: boolean;
}

interface LatencyStats {
  mrProcessingTimes: number[];
  providerTimes: number[];
  totalTimes: number[];
  successCount: number;
  failCount: number;
}

interface MemoryKey {
  id: string;
  key: string;
  name: string;
  isActive: boolean;
}

const API_BASE = "https://api.memoryrouter.ai";

const testPrompts = [
  "What is 2+2?",
  "Say hello in 3 words.",
  "What color is the sky?",
  "Count to 5.",
  "Name a fruit.",
];

export default function PlaygroundPage() {
  const [memoryKeys, setMemoryKeys] = useState<MemoryKey[]>([]);
  const [selectedKeyId, setSelectedKeyId] = useState<string>("");
  const [isLoadingKeys, setIsLoadingKeys] = useState(true);
  const [model, setModel] = useState("openai/gpt-4o");
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [currentMR, setCurrentMR] = useState<number | null>(null);
  const [currentTotal, setCurrentTotal] = useState<number | null>(null);
  const [isBenchmarking, setIsBenchmarking] = useState(false);
  const [benchmarkProgress, setBenchmarkProgress] = useState(0);

  const [stats, setStats] = useState<LatencyStats>({
    mrProcessingTimes: [],
    providerTimes: [],
    totalTimes: [],
    successCount: 0,
    failCount: 0,
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Fetch memory keys
  useEffect(() => {
    async function fetchKeys() {
      try {
        const response = await fetch("/api/keys/memory");
        if (response.ok) {
          const data = await response.json();
          const keys = data.keys || [];
          setMemoryKeys(keys);
          // Pre-select first key
          if (keys.length > 0 && !selectedKeyId) {
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
  }, [selectedKeyId]);

  // Load saved model from localStorage
  useEffect(() => {
    const savedModel = localStorage.getItem("memoryrouter_model");
    if (savedModel) setModel(savedModel);
  }, []);

  // Save model to localStorage
  useEffect(() => {
    if (model) localStorage.setItem("memoryrouter_model", model);
  }, [model]);

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  const selectedKey = memoryKeys.find((k) => k.id === selectedKeyId);

  const getContextMessages = () => {
    return messages.slice(-3).map((m) => ({
      role: m.role,
      content: m.content,
    }));
  };

  const updateStats = (
    mrTime: number | null,
    providerTime: number | null,
    totalTime: number | null,
    success: boolean
  ) => {
    setStats((prev) => {
      const newStats = { ...prev };
      if (mrTime !== null && providerTime !== null && totalTime !== null) {
        newStats.mrProcessingTimes = [...prev.mrProcessingTimes, mrTime];
        newStats.providerTimes = [...prev.providerTimes, providerTime];
        newStats.totalTimes = [...prev.totalTimes, totalTime];
      }
      if (success) newStats.successCount++;
      else newStats.failCount++;
      return newStats;
    });
  };

  const avg = (arr: number[]) =>
    arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  const sendMessage = useCallback(
    async (messageText?: string) => {
      const userMessage = messageText || inputValue.trim();
      if (!userMessage) return;

      if (!selectedKey) {
        alert("Please select a memory key");
        return;
      }

      if (!model) {
        alert("Please enter a model");
        return;
      }

      setInputValue("");
      setIsLoading(true);
      setIsStreaming(true);
      setStreamingContent("");
      setCurrentMR(null);
      setCurrentTotal(null);

      // Add user message
      setMessages((prev) => [...prev, { role: "user", content: userMessage }]);

      // Build context
      const contextMessages = getContextMessages();
      const apiMessages = [
        ...contextMessages.slice(0, -1),
        { role: "user", content: userMessage },
      ];

      const startTime = performance.now();
      let mrProcessingMs = 0;
      let providerMs = 0;
      let fullResponse = "";

      try {
        const response = await fetch(`${API_BASE}/v1/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${selectedKey.key}`,
          },
          body: JSON.stringify({
            model,
            messages: apiMessages,
            stream: true,
          }),
        });

        mrProcessingMs = parseInt(
          response.headers.get("X-MR-Processing-Ms") || "0"
        );
        providerMs = parseInt(
          response.headers.get("X-Provider-Response-Ms") || "0"
        );
        setCurrentMR(mrProcessingMs);

        if (!response.ok) {
          const endTime = performance.now();
          const errorData = await response.json().catch(() => ({
            error: { message: response.statusText },
          }));
          const errorMsg =
            errorData.error?.message ||
            errorData.error?.provider_error?.error?.message ||
            "Request failed";

          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: `Error: ${errorMsg}`,
              isError: true,
              totalTime: endTime - startTime,
            },
          ]);
          updateStats(null, null, null, false);
          setIsStreaming(false);
          setIsLoading(false);
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No reader");

        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (line.startsWith("data: ") && !line.includes("[DONE]")) {
              try {
                const data = JSON.parse(line.slice(6));
                const content = data.choices?.[0]?.delta?.content;
                const anthropicContent = data.delta?.text;

                if (content) fullResponse += content;
                if (anthropicContent) fullResponse += anthropicContent;

                if (content || anthropicContent) {
                  setStreamingContent(fullResponse);
                }
              } catch {
                // Ignore parse errors
              }
            }
          }
        }

        const endTime = performance.now();
        const totalTime = endTime - startTime;
        setCurrentTotal(totalTime);

        // Add assistant message
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: fullResponse,
            mrTime: mrProcessingMs,
            totalTime,
          },
        ]);

        updateStats(mrProcessingMs, providerMs, totalTime, true);
      } catch (error) {
        const endTime = performance.now();
        const totalTime = endTime - startTime;

        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `Network error: ${
              error instanceof Error ? error.message : "Unknown error"
            }`,
            isError: true,
            totalTime,
          },
        ]);
        updateStats(null, null, null, false);
      } finally {
        setIsStreaming(false);
        setIsLoading(false);
        setStreamingContent("");
        inputRef.current?.focus();
      }
    },
    [inputValue, selectedKey, model, messages]
  );

  const runBenchmark = async () => {
    if (!selectedKey || !model) {
      alert("Please select a key and model first");
      return;
    }

    setIsBenchmarking(true);

    for (let i = 0; i < testPrompts.length; i++) {
      setBenchmarkProgress(i + 1);
      await sendMessage(testPrompts[i]);
      await new Promise((r) => setTimeout(r, 500));
    }

    setIsBenchmarking(false);
    setBenchmarkProgress(0);

    const avgMR = Math.round(avg(stats.mrProcessingTimes));
    alert(`Benchmark complete!\n\nAvg MR Processing: ${avgMR}ms`);
  };

  const formatTime = (ms: number) => {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const getMRColor = (ms: number) => {
    if (ms > 500) return "text-red-400";
    if (ms > 200) return "text-yellow-400";
    return "text-neon-green";
  };

  const lastMR = stats.mrProcessingTimes[stats.mrProcessingTimes.length - 1];
  const lastProvider = stats.providerTimes[stats.providerTimes.length - 1];
  const lastTotal = stats.totalTimes[stats.totalTimes.length - 1];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold gradient-text">Playground</h1>
          <p className="text-muted-foreground mt-1">
            Test MemoryRouter latency with real requests
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Key Selector */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground uppercase tracking-wide">
              Memory Key
            </Label>
            {isLoadingKeys ? (
              <div className="flex items-center gap-2 h-10 px-3 bg-muted/50 rounded-md border border-white/[0.08]">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm text-muted-foreground">Loading...</span>
              </div>
            ) : memoryKeys.length === 0 ? (
              <div className="flex items-center gap-2 h-10 px-3 bg-muted/50 rounded-md border border-white/[0.08]">
                <Key className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">No keys found</span>
              </div>
            ) : (
              <Select value={selectedKeyId} onValueChange={setSelectedKeyId}>
                <SelectTrigger className="w-[200px] bg-muted/50">
                  <SelectValue placeholder="Select a key" />
                </SelectTrigger>
                <SelectContent>
                  {memoryKeys.map((key) => (
                    <SelectItem key={key.id} value={key.id}>
                      <div className="flex items-center gap-2">
                        <Key className="h-3 w-3 text-primary" />
                        <span>{key.name || "Untitled"}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Model Input */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground uppercase tracking-wide">
              Model
            </Label>
            <Input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="openai/gpt-4o"
              className="w-[180px] bg-muted/50"
            />
          </div>

          {/* Benchmark Button */}
          <Button
            onClick={runBenchmark}
            disabled={isBenchmarking || isLoading || !selectedKey}
            variant="outline"
            className="self-end border-primary/30 text-primary hover:bg-primary/10"
          >
            {isBenchmarking ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {benchmarkProgress}/5...
              </>
            ) : (
              <>
                <Zap className="h-4 w-4 mr-2" />
                Benchmark
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Latency Metrics */}
      <Card className="glass-card border-white/[0.08]">
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              Latency Metrics
            </h2>
            <span className="bg-primary/15 text-primary text-[11px] px-2 py-0.5 rounded font-medium">
              STREAMING
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            {/* Hero: MR Processing */}
            <div
              className={`stat-card rounded-xl p-4 ${
                lastMR && lastMR > 500
                  ? "border-red-500/50"
                  : lastMR && lastMR > 200
                  ? "border-yellow-500/50"
                  : "border-primary/30"
              } bg-gradient-to-br from-primary/5 to-transparent`}
            >
              <div className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">
                MR Processing
              </div>
              <div
                className={`text-2xl font-bold ${
                  lastMR ? getMRColor(lastMR) : "text-neon-green"
                }`}
              >
                {lastMR ? Math.round(lastMR) : "—"}
                <span className="text-sm font-normal ml-0.5">ms</span>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Our overhead
              </div>
            </div>

            <div className="stat-card rounded-xl p-4">
              <div className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">
                AI Provider
              </div>
              <div className="text-2xl font-bold text-neon-green">
                {lastProvider ? Math.round(lastProvider) : "—"}
                <span className="text-sm font-normal ml-0.5">ms</span>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                OpenAI/Anthropic
              </div>
            </div>

            <div className="stat-card rounded-xl p-4">
              <div className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">
                Total Time
              </div>
              <div className="text-2xl font-bold text-neon-green">
                {lastTotal ? Math.round(lastTotal) : "—"}
                <span className="text-sm font-normal ml-0.5">ms</span>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                End to end
              </div>
            </div>

            <div className="stat-card rounded-xl p-4">
              <div className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">
                Avg MR
              </div>
              <div className="text-2xl font-bold text-neon-green">
                {stats.mrProcessingTimes.length
                  ? Math.round(avg(stats.mrProcessingTimes))
                  : "—"}
                <span className="text-sm font-normal ml-0.5">ms</span>
              </div>
            </div>

            <div className="stat-card rounded-xl p-4">
              <div className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">
                Avg Provider
              </div>
              <div className="text-2xl font-bold text-neon-green">
                {stats.providerTimes.length
                  ? Math.round(avg(stats.providerTimes))
                  : "—"}
                <span className="text-sm font-normal ml-0.5">ms</span>
              </div>
            </div>

            <div className="stat-card rounded-xl p-4">
              <div className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">
                Avg Total
              </div>
              <div className="text-2xl font-bold text-neon-green">
                {stats.totalTimes.length
                  ? Math.round(avg(stats.totalTimes))
                  : "—"}
                <span className="text-sm font-normal ml-0.5">ms</span>
              </div>
            </div>
          </div>

          <div className="flex gap-6 mt-4 pt-4 border-t border-white/[0.08] text-sm">
            <div>
              <span className="text-muted-foreground">Requests:</span>{" "}
              <span className="font-semibold">
                {stats.successCount + stats.failCount}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Success:</span>{" "}
              <span className="font-semibold text-neon-green">
                {stats.successCount}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Failed:</span>{" "}
              <span className="font-semibold text-red-400">{stats.failCount}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Chat Area */}
      <Card className="glass-card border-white/[0.08]">
        <CardContent className="p-0">
          {/* Messages */}
          <div className="h-[400px] overflow-y-auto p-6 flex flex-col gap-4">
            {messages.length === 0 && !isStreaming && (
              <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-4 py-12">
                <Zap className="h-16 w-16 opacity-30" />
                <h2 className="text-lg font-medium text-foreground">
                  Test MemoryRouter Latency
                </h2>
                <p className="text-sm text-center max-w-md">
                  Measures{" "}
                  <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
                    MR Processing
                  </code>{" "}
                  — the latency MemoryRouter adds.
                  <br />
                  <br />
                  Last 3 messages sent as context. Uses streaming to measure real
                  latency.
                </p>
              </div>
            )}

            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex flex-col gap-2 max-w-[85%] ${
                  msg.role === "user" ? "self-end" : "self-start"
                }`}
              >
                <div
                  className={`flex items-center gap-2 text-xs text-muted-foreground ${
                    msg.role === "user" ? "justify-end" : ""
                  }`}
                >
                  <span className="font-semibold uppercase tracking-wide">
                    {msg.role === "user" ? "You" : "Assistant"}
                  </span>
                  {msg.mrTime !== undefined && (
                    <span className="font-mono">
                      <span className="text-neon-green">
                        MR: {Math.round(msg.mrTime)}ms
                      </span>
                      {msg.totalTime && (
                        <span className="text-muted-foreground">
                          {" "}
                          · Total: {formatTime(msg.totalTime)}
                        </span>
                      )}
                    </span>
                  )}
                </div>
                <div
                  className={`px-4 py-3 rounded-xl text-[15px] leading-relaxed whitespace-pre-wrap ${
                    msg.role === "user"
                      ? "bg-primary/20 rounded-br-sm"
                      : msg.isError
                      ? "bg-red-500/10 border border-red-500 text-red-400 rounded-bl-sm"
                      : "bg-muted border border-white/[0.08] rounded-bl-sm"
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}

            {/* Streaming message */}
            {isStreaming && (
              <div className="flex flex-col gap-2 max-w-[85%] self-start">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-semibold uppercase tracking-wide">
                    Assistant
                  </span>
                  {currentMR !== null && (
                    <span className="font-mono text-neon-green">
                      MR: {Math.round(currentMR)}ms
                    </span>
                  )}
                </div>
                <div className="bg-muted border border-white/[0.08] rounded-xl rounded-bl-sm px-4 py-3 text-[15px] leading-relaxed whitespace-pre-wrap">
                  {streamingContent || ""}
                  <span className="inline-block w-2 h-4 bg-primary ml-0.5 animate-pulse" />
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Context info */}
          {messages.length > 0 && (
            <div className="text-xs text-muted-foreground text-center py-2 border-t border-white/[0.08]">
              Sending{" "}
              <span className="text-primary">
                {Math.min(messages.length, 3)}
              </span>{" "}
              messages as context
            </div>
          )}

          {/* Input */}
          <div className="flex gap-3 p-4 border-t border-white/[0.08]">
            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (!isLoading) sendMessage();
                }
              }}
              placeholder={selectedKey ? "Type a message..." : "Select a memory key to start"}
              disabled={!selectedKey}
              rows={1}
              className="flex-1 bg-muted/50 border border-white/[0.08] rounded-lg px-4 py-3 text-[15px] focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none min-h-[48px] max-h-[150px] disabled:opacity-50"
            />
            <Button
              onClick={() => sendMessage()}
              disabled={isLoading || !inputValue.trim() || !selectedKey}
              className="btn-neon px-6"
            >
              <Send className="h-4 w-4 mr-2" />
              Send
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
