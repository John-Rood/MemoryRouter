# MemoryRouter Engagement Email Sequence

This folder contains 5 engagement emails for newsletter subscribers.

## Schedule

| Email | Day | Subject | Purpose |
|-------|-----|---------|---------|
| 01-welcome.md | 0 | The $10 you're leaving on the table | Introduce the value prop |
| 02-problem.md | 3 | Your AI has amnesia (and it's expensive) | Articulate the pain |
| 03-solution.md | 7 | How we make AI remember (technical edition) | Explain KRONOS |
| 04-social-proof.md | 14 | What 500+ developers are building with memory | Show use cases |
| 05-cta.md | 21 | Your invite to MemoryRouter | Drive signups |

## Tone

- **Conversational**, not corporate
- **Direct** — John's voice as founder
- **Technical** when needed, accessible always
- **Value-focused** — always tie back to savings

## Template Variables

- `{{firstName}}` — Subscriber's first name (default: "there")
- `{{email}}` — Subscriber's email

## Resend Setup (Manual Steps)

1. **Create Audience** in Resend dashboard:
   - Name: `memoryrouter-newsletter`
   - Copy the Audience ID

2. **Add to `.env.local`**:
   ```
   RESEND_AUDIENCE_ID=aud_xxxxxxxxxxxxx
   ```

3. **Set up Broadcasts** in Resend:
   - Create a broadcast for each email
   - Set delay from signup date
   - Use audience: memoryrouter-newsletter

## API Endpoint

Newsletter signups hit:
```
POST https://app.memoryrouter.ai/api/newsletter
Body: { "email": "user@example.com", "firstName": "John" }
```

This adds the contact to the Resend audience and sends the immediate welcome email.

---

*Last updated: Feb 2026*
