# Module Draft - Activity QR Check-in

Status: Candidate for reuse.

Verified source project: Sakura Welfare Platform.

## Purpose

Manage activity calendar, QR check-in, and attendance statistics without point reward.

## Core Features

- Admin creates events in a calendar-style interface.
- Event visibility can be selected:
  - all
  - visitor
  - employee
  - manager
- System generates QR check-in entry.
- Member checks in.
- System records attendance.
- Admin can export or inspect attendance list.
- Member portal shows activity records.

## Sakura Routes

- `/activity-checkin-admin`
- Member portal activity tab.

## Key Data

- Event title.
- Event date/time.
- Location.
- Visibility group.
- Description.
- QR/check-in token.
- Attendee identity and check-in timestamp.

## Risks

- Calendar navigation unclear on mobile.
- Collapsible calendar state needs visible hint.
- Member identity may be visitor or employee.
- QR should not grant points in this flow.

## Acceptance Checks

- Admin can move previous/next month.
- Admin can create event with visibility groups.
- Member can see eligible events.
- QR check-in records attendance.
- Attendance list shows correct names and timestamps.

