import { NextRequest, NextResponse } from "next/server";

// Validation endpoints for each provider
const VALIDATION_ENDPOINTS: Record<string, { url: string; headers: (key: string) => Record<string, string> }> = {
  openai: {
    url: "https://api.openai.com/v1/models",
    headers: (key) => ({ "Authorization": `Bearer ${key}` }),
  },
  anthropic: {
    url: "https://api.anthropic.com/v1/messages",
    headers: (key) => ({
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    }),
  },
  google: {
    url: "https://generativelanguage.googleapis.com/v1/models",
    headers: (key) => ({}), // Key is passed as query param
  },
  openrouter: {
    url: "https://openrouter.ai/api/v1/models",
    headers: (key) => ({ "Authorization": `Bearer ${key}` }),
  },
};

export async function POST(request: NextRequest) {
  try {
    const { provider, apiKey } = await request.json();

    if (!provider || !apiKey) {
      return NextResponse.json(
        { valid: false, error: "Provider and API key are required" },
        { status: 400 }
      );
    }

    const config = VALIDATION_ENDPOINTS[provider];
    if (!config) {
      return NextResponse.json(
        { valid: false, error: "Unknown provider" },
        { status: 400 }
      );
    }

    // Build the request
    let url = config.url;
    const headers = config.headers(apiKey);

    // Google uses query param for API key
    if (provider === "google") {
      url = `${config.url}?key=${apiKey}`;
    }

    // For Anthropic, we need to make a minimal request (can't just list models)
    if (provider === "anthropic") {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: "claude-3-haiku-20240307",
          max_tokens: 1,
          messages: [{ role: "user", content: "hi" }],
        }),
      });

      // 401 = invalid key, 200 = valid (we don't care about the actual response)
      // 400 = key is valid but request might be malformed (still valid key)
      if (response.status === 401 || response.status === 403) {
        return NextResponse.json({ valid: false, error: "Invalid API key" });
      }

      return NextResponse.json({ valid: true });
    }

    // For others, just try to list models
    const response = await fetch(url, {
      method: "GET",
      headers,
    });

    if (response.status === 401 || response.status === 403) {
      return NextResponse.json({ valid: false, error: "Invalid API key" });
    }

    if (!response.ok) {
      // Some other error, but key might still be valid
      const text = await response.text();
      console.error(`Provider ${provider} returned ${response.status}: ${text}`);
      
      // If it's a rate limit or server error, assume key is valid
      if (response.status === 429 || response.status >= 500) {
        return NextResponse.json({ valid: true });
      }
      
      return NextResponse.json({ valid: false, error: "Could not validate key" });
    }

    return NextResponse.json({ valid: true });

  } catch (error) {
    console.error("Key validation error:", error);
    return NextResponse.json(
      { valid: false, error: "Validation failed" },
      { status: 500 }
    );
  }
}
