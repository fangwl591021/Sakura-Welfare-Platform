# Module Draft - LINE OA Monitoring Console

Status: Candidate for reuse.

Verified source project: Sakura Welfare Platform and TravelKeeper reference.

## Purpose

Provide a management console for LINE OA messages, AI classification, suggested replies, complaint tracking, and internal notes.

## Core Features

- Thread list.
- Message timeline.
- User display name and avatar backfill.
- AI classification and priority.
- Suggested reply.
- Internal note.
- Manual reply through official API when appropriate.
- Status: pending, processed, archived, high risk.

## Sakura Routes

- `/line-oa-monitor`
- `/api/line-oa/*` style endpoints where implemented.
- `/hub-test`

## Key Tables

- `line_threads`
- `line_messages`
- `line_webhook_events`
- `line_webhook_intake_logs`

## Required Secrets

- `LINE_CHANNEL_ACCESS_TOKEN`
- `OPENAI_API_KEY`
- `DB`

## Risks

- LINE webhook does not include display name and avatar by default.
- Profile API can fail or require backfill.
- Admin replies must be written back to the conversation record.
- AI suggestion must not auto-send sensitive replies.

## Acceptance Checks

- New LINE message appears without page refresh or through clear sync.
- Thread shows display name and avatar when profile is available.
- Admin reply is sent and saved in local message history.
- AI suggestion appears when OpenAI key is configured.
- Complaint/high-risk tag is visible.

