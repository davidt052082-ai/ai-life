# Health Management MVP Design

## Purpose

Add a permission-protected “健康管理 → 腹型减脂” project to AI Life. The MVP makes daily health actions quick to record, exposes a clear daily plan and weekly feedback loop, and stores meal photos for later analysis. It does not connect any AI, wearable, PWA, Web Push, or background synchronization service.

## Chosen Architecture

Extend the current Express and PostgreSQL monolith instead of creating a separate application. The implementation reuses the existing session, project-access middleware, project directory, migration runner, and Node test suite.

The project has code `health`, route `/projects/health`, and uses the existing group/project authorization model. The project-home card navigates to the health page only for authorized users.

New health code has clear boundaries:

- `src/routes/healthRoutes.js` owns HTTP validation, authorization, and response mapping.
- `src/repositories/healthRepository.js` owns PostgreSQL persistence and transactions.
- `src/health/plan.js`, `src/health/summary.js`, and `src/health/scoring.js` are deterministic, database-free domain functions.
- `health.html` and `health-client.js` render and operate the health project page.

## Data Model

A new migration creates records scoped by `user_id` and the health `project_id`.

- `health_settings`: timezone, hydration target, plan-day cutoff (default 01:00), and optional abdominal-massage helper flag.
- `health_events`: append-only hydration and check-in actions, with `event_id`, `idempotency_key`, `event_type`, JSON payload, UTC occurrence timestamp, local timezone, `plan_date`, source, sync status, version, and audit timestamps. A unique `(user_id, idempotency_key)` constraint makes all create actions idempotent.
- `health_measurements`: manual body measurements for one occurrence timestamp; includes nullable weight and waist values, source, idempotency key, audit metadata, and a uniqueness constraint for idempotent saves.
- `health_meals`: one uploaded photo record with meal type, capture timestamp, planned date, safe storage key, original filename metadata, MIME type, bytes, status `pending_analysis`, and timestamps. No food or nutrition fields are persisted before AI is integrated.
- `health_notifications`: deduplicated in-app reminders with a date, reminder kind, message, read timestamp, and creation timestamp.

Rows store UTC timestamps plus the user timezone. Hydration, meals, and behavior belong to the local natural day. Training completed before the configured next-day 01:00 cutoff belongs to the prior plan day; its original timestamp is unchanged. A later sleep integration must associate sleep with the day it ends.

## Daily Plan and Interaction

The responsive Today page is action-first. Its first viewport shows the daily completion percentage, remaining tasks, fluid progress, the current contextual action, and large mobile-safe quick buttons.

Default schedule:

- Breakfast, lunch, and dinner photo prompts follow their defined time windows.
- Hydration uses water +200/+300/+500 ml and tea +200/+300 ml actions against a default 1700 ml daily target. Training days can use a displayed dynamic target of 2000–2300 ml without rewriting historical records.
- Post-meal walk supports up to two daily check-ins.
- The weekly training plan is fast walking Monday/Wednesday, strength Tuesday, Baduanjin recovery Thursday, kettlebell strength Friday, long walking Saturday, and review/rest Sunday.
- Thursday displays a 15–25 minute Baduanjin recovery task. It is visible and tracked but excluded from core fat-loss score.
- “No alcohol”, “no late snack”, and “no sugary drink” are daily behaviors.
- The abdominal-massage helper is hidden unless the user enables it in settings. It is described only as an optional bloating/constipation comfort aid, never as fat loss, and never affects the score.

Quick actions render uncompleted, submitting, complete, or failed states. Submit optimistically, disable while pending, and show a five-to-eight second undo snackbar after successful hydration and check-ins. Undo applies a compensating action in a transaction and updates the summary. Failed writes remain visibly failed and offer an explicit retry in this MVP; offline persistence and automatic retries are MVP+ work.

## Meal Photos Without AI

The browser provides a camera-capable file input with `capture="environment"` and a regular file-picker fallback. Before upload it fixes orientation through browser rendering, resizes its long edge to 1600px or less, re-encodes WebP/JPEG at an approximately 0.8 quality setting, and drops metadata by re-encoding.

The server accepts only bounded-size image uploads, generates a non-user-controlled storage name, and saves outside executable static paths. The meal record becomes `pending_analysis`. The UI lists photos by date and clearly states “待 AI 分析”; it never invents food, portion, calorie, or nutrient values. A future analysis adapter can transition these rows through analyzing, confirmation, and confirmed states.

## Aggregation, Scoring, and Reports

`GET /api/health/today` combines the generated plan with events, measurements, meals, and relevant notifications. It is a calculated view, not an independently editable counter.

The weekly execution score follows the specified 30/20/10/10/10/8/7/5 weighting for cardio, strength, walks, hydration, alcohol-free days, sleep, meal-photo completion, and waist measurement. Meal photos count only as photo completion in this release. If sleep is unavailable, its 8% is redistributed proportionally among scored available dimensions; no user is penalized for an unavailable integration. Baduanjin, massage, and core activation do not contribute to this core score.

The weekly comparison reports plan, actual, rate, and difference for supported metrics. The weekly report aggregates raw data on every read. Editing or deleting historical health data therefore immediately changes all affected weekly summaries; no stale denormalized weekly table is stored. Four-week outcome status requires enough waist and weight data; otherwise it shows “数据积累中”, not an outcome inference.

## API Surface

All endpoints require a signed-in user with health project access.

- `GET /api/health/today?date=YYYY-MM-DD`
- `GET /api/health/plan?date=YYYY-MM-DD`
- `POST /api/health/hydration`, `POST /api/health/checkins`, and `POST /api/health/measurements` with an `Idempotency-Key` header.
- `POST /api/health/events/:eventId/undo`
- `POST /api/health/meals` as multipart upload; `GET /api/health/meals?date=...`; `DELETE /api/health/meals/:id`
- `GET /api/health/trends`, `GET /api/health/plan-vs-actual?week=YYYY-Www`, and `GET /api/health/weekly-report?week=YYYY-Www`
- `GET/PATCH /api/health/settings`
- `GET /api/health/notifications` and `PATCH /api/health/notifications/:id`

Create responses consistently return the entity, `event_id` where applicable, `sync_status`, and a server version. Retrying a known idempotency key returns the original result rather than adding another amount or check-in.

## In-App Reminders

The application creates and presents deduplicated in-app reminders on health page access, based on time windows and currently incomplete critical items. It neither asks browser notification permission nor runs a scheduler in the MVP. Future Web Push will consume the same reminder rules without changing health records.

## Error Handling and Privacy

Validation rejects invalid dates, metric ranges, unsupported check-in types, negative fluid amounts, invalid MIME types, unauthorised project access, and oversized files with clear JSON errors. The UI retains user-entered state where possible and exposes a retry after recoverable API failures. Image access is authenticated through health routes; filenames and storage keys are never trusted from the client.

## Test Strategy

Add Node tests for:

- migration schema, project catalog registration, and group-access enforcement;
- plan generation, Thursday recovery task, time-window emphasis, date/cutoff attribution, and massage visibility;
- idempotency for hydration, check-ins, and measurements; undo behavior and totals;
- score weighting and redistribution when sleep is absent; exclusion of Baduanjin and massage;
- daily, weekly, trend, comparison, four-week-insufficient-data, and historical-edit recalculation;
- image MIME/size validation, safe upload handling, pending-analysis persistence, deletion authorization, and no fabricated nutrition;
- page rendering, mobile quick-action labels, failed/retry state, and existing-suite compatibility.

## Explicitly Deferred

OpenAI/vision analysis, nutrition database lookup, meal confirmation and reuse, PWA installation, Service Worker caching, IndexedDB queue, background sync, Web Push, background scheduled delivery, and device/scale/wearable integrations are deferred. The storage and status model intentionally leaves an adapter seam for those additions.
