# Module Draft - LINE Dual Webhook Gateway

Status: Candidate for reuse.

Verified source project: Sakura Welfare Platform.

## Purpose

Provide a single LINE OA webhook ingress through Cloudflare Worker while preserving mother-site behavior and allowing child-site monitoring or business logic.

## Core Pattern

1. LINE OA posts events to Worker `/line-webhook`.
2. Worker verifies `x-line-signature`.
3. Worker records intake logs.
4. Worker forwards to mother-site webhook when required.
5. Worker writes child-site message/event data to D1.
6. Only one component should use `replyToken` for a user-facing response.

## Sakura Routes

- `/line-webhook`
- `/line-child-webhook`
- `/hub-test`

## Required Bindings / Secrets

- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `MOTHER_WEBHOOK_URL`
- `DB`

## Key Tables

- `line_webhook_intake_logs`
- `line_webhook_events`
- `line_threads`
- `line_messages`

## Risks

- Duplicate replyToken use.
- Child site swallowing mother-site keyword behavior.
- Signature verification bypass during tests.
- Slow reply flow if non-critical work is not deferred.

## Acceptance Checks

- LINE verify succeeds.
- Signature status appears in intake logs.
- Mother-site keyword still responds.
- Child-site D1 receives the event.
- Unknown text does not break mother-site flow.

