# Code Examples

Copy-paste examples for every language.

---

## Python (OpenAI SDK)

```python
from openai import OpenAI

client = OpenAI(
    api_key="mk_xxxxxxxxxxxxxxxx",
    base_url="https://api.memoryrouter.ai/v1"
)

response = client.chat.completions.create(
    model="openai/gpt-4o",
    messages=[{"role": "user", "content": "My name is Alice"}]
)
print(response.choices[0].message.content)
```

### With Sessions

```python
response = client.chat.completions.create(
    model="openai/gpt-4o",
    messages=[{"role": "user", "content": "I'm planning a trip to Japan"}],
    extra_headers={"X-Session-ID": "user-123-planning"}
)
```

### Streaming

```python
stream = client.chat.completions.create(
    model="openai/gpt-4o",
    messages=[{"role": "user", "content": "Tell me a story"}],
    stream=True
)

for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="")
```

### Pass-Through (BYOK)

```python
client = OpenAI(
    api_key="sk-your-openai-key",
    base_url="https://api.memoryrouter.ai/v1",
    default_headers={"X-Memory-Key": "mk_xxxxxxxxxxxxxxxx"}
)
```

---

## Python (Anthropic SDK)

```python
from anthropic import Anthropic

client = Anthropic(
    api_key="mk_xxxxxxxxxxxxxxxx",
    base_url="https://api.memoryrouter.ai"
)

message = client.messages.create(
    model="claude-3-5-sonnet",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello"}]
)
print(message.content[0].text)
```

---

## JavaScript

```javascript
import OpenAI from 'openai';

const client = new OpenAI({
    apiKey: 'mk_xxxxxxxxxxxxxxxx',
    baseURL: 'https://api.memoryrouter.ai/v1'
});

const response = await client.chat.completions.create({
    model: 'openai/gpt-4o',
    messages: [{ role: 'user', content: 'Hello!' }]
});
console.log(response.choices[0].message.content);
```

### Streaming

```javascript
const stream = await client.chat.completions.create({
    model: 'openai/gpt-4o',
    messages: [{ role: 'user', content: 'Tell me a story' }],
    stream: true
});

for await (const chunk of stream) {
    process.stdout.write(chunk.choices[0]?.delta?.content || '');
}
```

---

## curl

```bash
curl -X POST https://api.memoryrouter.ai/v1/chat/completions \
  -H "Authorization: Bearer mk_xxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-4o",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### With Session

```bash
curl -X POST https://api.memoryrouter.ai/v1/chat/completions \
  -H "Authorization: Bearer mk_xxxxxxxxxxxxxxxx" \
  -H "X-Session-ID: user-123" \
  -H "Content-Type: application/json" \
  -d '{"model": "openai/gpt-4o", "messages": [{"role": "user", "content": "Hello!"}]}'
```

---

## Go

```go
package main

import (
    "context"
    "fmt"
    "github.com/sashabaranov/go-openai"
)

func main() {
    config := openai.DefaultConfig("mk_xxxxxxxxxxxxxxxx")
    config.BaseURL = "https://api.memoryrouter.ai/v1"
    client := openai.NewClientWithConfig(config)

    resp, _ := client.CreateChatCompletion(
        context.Background(),
        openai.ChatCompletionRequest{
            Model: "openai/gpt-4o",
            Messages: []openai.ChatCompletionMessage{
                {Role: "user", Content: "Hello"},
            },
        },
    )
    fmt.Println(resp.Choices[0].Message.Content)
}
```

---

## Ruby

```ruby
require 'openai'

client = OpenAI::Client.new(
  access_token: 'mk_xxxxxxxxxxxxxxxx',
  uri_base: 'https://api.memoryrouter.ai/v1'
)

response = client.chat(
  parameters: {
    model: 'openai/gpt-4o',
    messages: [{ role: 'user', content: 'Hello' }]
  }
)
puts response.dig('choices', 0, 'message', 'content')
```

---

## PHP

```php
<?php
$ch = curl_init('https://api.memoryrouter.ai/v1/chat/completions');

curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_HTTPHEADER => [
        'Authorization: Bearer mk_xxxxxxxxxxxxxxxx',
        'Content-Type: application/json'
    ],
    CURLOPT_POSTFIELDS => json_encode([
        'model' => 'openai/gpt-4o',
        'messages' => [['role' => 'user', 'content' => 'Hello']]
    ])
]);

$response = curl_exec($ch);
$data = json_decode($response, true);
echo $data['choices'][0]['message']['content'];
```

---

## Multi-Tenant Pattern

Give each user isolated memory:

```python
def get_client_for_user(user_id: str, user_api_key: str):
    return OpenAI(
        api_key=user_api_key,
        base_url="https://api.memoryrouter.ai/v1",
        default_headers={"X-Memory-Key": f"mk_user_{user_id}"}
    )

# Each user gets their own memory vault
client_alice = get_client_for_user("alice", "sk-alice-key")
client_bob = get_client_for_user("bob", "sk-bob-key")
```
