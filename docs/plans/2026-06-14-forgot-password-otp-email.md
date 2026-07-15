# Forgot Password OTP Email Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a forgot-password flow that sends OTP codes by email, stores OTPs in backend memory for now, and keeps the storage boundary easy to swap to Redis later.

**Architecture:** Add three auth endpoints for requesting, verifying, and consuming password-reset OTPs. Keep OTP persistence behind a small store interface with an in-memory implementation today, and isolate email sending behind a lightweight mail service using SMTP via Nodemailer. Reuse the existing frontend page structure and replace the local mock flow with real API calls.

**Tech Stack:** NestJS, Prisma, bcrypt, Nodemailer, Next.js App Router, TypeScript

---

### Task 1: Add backend tests for forgot-password auth flow

**Files:**
- Modify: `BE/SmartElec_BE/src/auth/auth.service.spec.ts`

**Step 1: Write the failing test**

Add service-level tests for:
- requesting OTP for an existing email stores a code and sends email
- verifying OTP succeeds for the latest valid code
- resetting password updates the hashed password and clears the OTP
- invalid or missing email/OTP paths throw the expected Nest exceptions

**Step 2: Run test to verify it fails**

Run: `npm test -- auth.service.spec.ts`
Expected: FAIL because forgot-password methods and collaborators do not exist yet.

**Step 3: Write minimal implementation**

Add only enough backend code to satisfy each failing test before moving to the next one.

**Step 4: Run test to verify it passes**

Run: `npm test -- auth.service.spec.ts`
Expected: PASS

### Task 2: Add backend forgot-password primitives

**Files:**
- Create: `BE/SmartElec_BE/src/auth/dto/request-reset-otp.dto.ts`
- Create: `BE/SmartElec_BE/src/auth/dto/verify-reset-otp.dto.ts`
- Create: `BE/SmartElec_BE/src/auth/dto/reset-password.dto.ts`
- Create: `BE/SmartElec_BE/src/auth/forgot-password-otp.store.ts`
- Create: `BE/SmartElec_BE/src/auth/in-memory-forgot-password-otp.store.ts`
- Create: `BE/SmartElec_BE/src/auth/mail.service.ts`
- Modify: `BE/SmartElec_BE/src/auth/auth.module.ts`

**Step 1: Write the failing test**

Use the Task 1 tests to drive missing DTO validation and store behavior indirectly.

**Step 2: Run test to verify it fails**

Run: `npm test -- auth.service.spec.ts`
Expected: FAIL with missing provider or missing method errors.

**Step 3: Write minimal implementation**

Add:
- DTO validation for email, OTP, and new password
- `ForgotPasswordOtpStore` interface
- in-memory `Map`-based implementation with TTL and delete support
- SMTP mail service using env-configured transporter and a simple HTML/text OTP template

**Step 4: Run test to verify it passes**

Run: `npm test -- auth.service.spec.ts`
Expected: PASS

### Task 3: Add backend auth endpoints and service logic

**Files:**
- Modify: `BE/SmartElec_BE/src/auth/auth.controller.ts`
- Modify: `BE/SmartElec_BE/src/auth/auth.service.ts`

**Step 1: Write the failing test**

Extend the existing service tests or add targeted controller expectations if needed for:
- `POST /auth/forgot-password/request-otp`
- `POST /auth/forgot-password/verify-otp`
- `POST /auth/forgot-password/reset`

**Step 2: Run test to verify it fails**

Run: `npm test -- auth.service.spec.ts`
Expected: FAIL because controller/service methods do not exist or do not match expected behavior.

**Step 3: Write minimal implementation**

Implement:
- user lookup by email
- six-digit OTP generation
- OTP storage with expiration
- verify path without deleting OTP
- reset path that re-validates OTP, hashes the new password, updates Prisma, and removes OTP

**Step 4: Run test to verify it passes**

Run: `npm test -- auth.service.spec.ts`
Expected: PASS

### Task 4: Wire frontend forgot-password flow to backend APIs

**Files:**
- Modify: `FE/AI_ChatBot_TuVanSuaChuaDien_Website/fe_chatbot_website/app/auth/services/auth.service.ts`
- Modify: `FE/AI_ChatBot_TuVanSuaChuaDien_Website/fe_chatbot_website/app/auth/hooks/useAuthApi.ts`
- Modify: `FE/AI_ChatBot_TuVanSuaChuaDien_Website/fe_chatbot_website/app/auth/forgot-password/page.tsx`

**Step 1: Write the failing test**

No existing FE test harness is obvious here, so drive this step with type-check-safe changes and manual flow validation assumptions.

**Step 2: Run verification to expose current gap**

Run: frontend typecheck/lint command if present; otherwise rely on build-time TypeScript validation later.

**Step 3: Write minimal implementation**

Replace:
- unsupported mock API calls in `useAuthApi`
- local fake OTP step transitions in the page

With:
- request OTP API call
- verify OTP API call
- reset password API call
- loading/error/success handling bound to the existing form UI

**Step 4: Run verification**

Run the available FE verification command if present.

### Task 5: Verify and review the diff

**Files:**
- Review only changed files from Tasks 1-4

**Step 1: Run focused tests**

Run:
- `npm test -- auth.service.spec.ts`
- `npm run build`
- `npm run lint`

Expected:
- tests pass
- build passes or any failure is identified as pre-existing
- lint passes or any failure is identified as pre-existing

**Step 2: Inspect diff quality**

Run:
- `git diff --stat`
- `git diff --check`
- `git diff`

Expected:
- no unrelated files
- no accidental rewrites
- no debug leftovers

**Step 3: Document environment assumptions**

Record required env vars:
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`
- optional OTP TTL override if added
