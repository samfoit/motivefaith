# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

An installable PWA (Next.js on Vercel, Supabase backend). There is no native iOS or Android app; phone users install it from the browser. Push notifications and offline check-ins run through the app's own service worker.

## Users

Anyone who wants to build habits that stick, with friends keeping them accountable. The audience is broad, not only churchgoers: everyday habits (exercise, reading, journaling) sit alongside spiritual disciplines (prayer, scripture reading). Most use is on a phone, in short moments: checking in right after doing the thing, glancing at the day's habits, answering a friend's check-in.

People also come as **accountability partners** and **group members**: they see the check-ins shared with them, react, and send encouragement.

## Product Purpose

MotiveFaith helps people keep habits by doing them in front of people who care: you check in, your partners see it, and they cheer you on. Success means a habit that lasts. A user keeps showing up week after week, misses are handled honestly instead of quietly abandoned, and partners stay involved.

## Positioning

Four things together, which a generic habit tracker can't truthfully claim:

1. **Proof partners can see.** A check-in can carry a photo, video, voice note, or message, or be a quick tap. It goes to the partners and groups the user picked, who can react and reply in a shared thread.
2. **Grace, not guilt.** A missed day is handled honestly without shame: rain checks (with a reason such as sick, travel, rest, or busy, an optional note, and an option to move the day), habit pauses, and streak rules that respect both.
3. **Scripture woven in.** Verses (NIV) and faith language run through the product sincerely, not bolted on.
4. **Follows your day.** The Lamplight theme's colors and sky follow the user's hour, from before dawn to night, so the app feels like the time they're in.

## Operating Context

- Daily loop: open the dashboard, see today's habits within their time windows, check in, maybe attach proof, and see partners' activity in the feed.
- Social: friends added by username or invite link; groups joined by invite code; one chat thread per friend or group, with its own camera; an inbox for requests and notifications.
- Reflection: weekly reviews that can be looked back on later.
- Reminders and missed-habit alerts arrive as push notifications on every device the user has installed it on.
- Must work on flaky mobile connections. Check-ins and capture queue offline and sync later.

## Capabilities and Constraints

- **Schedules:** Every day, Weekdays, Weekends, Weekly, or Custom (set days), with time windows. Weekly is the longest period. **No Monthly option and no habits that cross midnight** (decided 2026-10-27; an overnight fast is logged on the day it ends).
- **Check-in types:** photo, video, voice, message, quick, rain check. Repeat check-ins are supported. A check-in can be private or shared per check-in, and habit visibility is set per partner.
- Streaks, milestones, pauses, missed alerts, weekly reviews, friends, groups, encouragements and reactions, admin moderation, DMCA process.
- Sign-in with email/password or Google; Turnstile on auth.
- Strict CSP with per-request nonce; offline-first app shell via a hand-built service worker.
- Users must be 13 or older (Terms of Service).
- Free. No paid plan exists; pricing is not decided and must not be implied.

## Brand Commitments

- Name: **MotiveFaith** (one word, capital M and F).
- The lamp mark (`public/icon-lamp-*.png`) and the Lamplight name for the hour-following theme.
- Anchor verse: "Your word is a lamp for my feet, a light on my path." (Psalm 119:105). Scripture is quoted from the NIV.
- **Voice: faith central, never preachy.** Christian at its core and doesn't hide it, but prayer and scripture are offered, never required. Copy and features must not assume the reader is a believer or shame anyone for missing a day.

## Evidence on Hand

- Pre-launch / beta: built and being tested with a small circle before a real launch.
- No testimonials, user counts, ratings, press, or case studies exist. Don't invent any, and don't imply a user base.
- Real content: the landing page's feature copy, the five-hour verse set, and the fact carousel (`src/app/page.tsx`, `src/app/landing-client.tsx`); legal pages under `src/app/legal/`.

## Product Principles

1. **Accountability is relational, not surveillance.** Sharing is chosen per partner and per check-in; partners exist to encourage, not to police.
2. **A miss is part of the habit.** Every flow around a missed day offers an honest, shame-free path forward (rain check, pause, move) rather than a broken streak and a guilt trip.
3. **Faith is offered, never imposed.** Scripture and faith language are sincere and present; nothing requires belief to use the product well.
4. **Habits recur often enough to form.** Keep the model on calendar days, weekly at most; turn down features that complicate that model for edge cases.
5. **Works in the moment, on any connection.** Checking in has to be fast and reliable on a phone, offline included.

## Accessibility & Inclusion

No formal standard has been committed to yet (open decision). In practice the codebase already holds hour-dependent palette colors to tested contrast, honors `prefers-reduced-motion`, and labels icon controls. Inclusion also means the welcome reaches users who aren't believers.
