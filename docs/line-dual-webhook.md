# LINE Dual Webhook Gateway

## Purpose

LINE Official Account only allows one webhook URL. This Worker endpoint receives LINE events once, verifies the LINE signature, then forwards the same raw event body to the mother site and optional child / monitor systems.

## Endpoint

Set this in LINE Developers:

```text
https://<your-worker-domain>/line-webhook
```

Local preview:

```text
http://127.0.0.1:8787/line-webhook
```

## Current Mother Webhook

```text
https://aiwe.cc/index.php/line_login/9111/
```

This is the default mother webhook in the Worker. It can also be overridden by `MOTHER_WEBHOOK_URL`.

## Environment Variables

Required:

```text
LINE_CHANNEL_SECRET
```

Optional:

```text
MOTHER_WEBHOOK_URL
CHILD_WEBHOOK_URL
FORWARD_WEBHOOK_URL
MONITOR_WEBHOOK_URL
```

If `CHILD_WEBHOOK_URL` is not set, the Worker forwards to its built-in child receiver:

```text
https://<your-worker-domain>/line-child-webhook
```

`CHILD_WEBHOOK_URL`, `FORWARD_WEBHOOK_URL`, and `MONITOR_WEBHOOK_URL` are secondary targets. The Worker forwards to them in the background, so they do not block the LINE response.

## Wrangler Setup

```powershell
npx wrangler secret put LINE_CHANNEL_SECRET
npx wrangler secret put CHILD_WEBHOOK_URL
npx wrangler secret put MONITOR_WEBHOOK_URL
```

If the mother webhook changes:

```powershell
npx wrangler secret put MOTHER_WEBHOOK_URL
```

## Flow

```text
LINE OA
  -> Cloudflare Worker /line-webhook
    -> verify x-line-signature
    -> mother webhook: https://aiwe.cc/index.php/line_login/9111/
    -> child webhook: /line-child-webhook
    -> optional AI monitor webhook in background
  -> return JSON success to LINE
```

## Built-in Child Receiver

```text
GET/POST https://<your-worker-domain>/line-child-webhook
```

The child receiver currently parses LINE events and returns basic AI-monitor-ready classification:

```text
general
complaint
praise
risk
vendor_support
```

This is the extension point for later D1 storage, AI sentiment analysis, dashboard alerts, and committee follow-up tasks.

## Forwarded Headers

The Worker forwards:

```text
Content-Type: application/json
x-line-signature: <original LINE signature>
x-sakura-webhook-gateway: cloudflare-worker
x-sakura-webhook-target: mother | secondary
```

Downstream systems can still verify the original LINE signature because the raw body is forwarded unchanged.

## Important Notes

- Only one downstream system should actively use the LINE `replyToken`; LINE reply tokens are single-use.
- Recommended rule: mother site handles official member binding / login reply, while child and monitor systems record, classify, or create tasks.
- If the mother webhook fails, the Worker returns a failure JSON so LINE can retry the event.
- Secondary webhook failures do not block LINE because they are sent in the background.
