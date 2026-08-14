# AI Web SOLID Stage 2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Chia `src/ai_web` thành các folder theo trách nhiệm và làm mỏng service lớn mà không đổi hành vi hay API.

**Architecture:** `AiService` tiếp tục là facade và `AiGuidedDiagnosisService` tiếp tục điều phối deterministic. Service/test được chuyển cùng nhau; dependency được import trực tiếp theo folder mới.

**Tech Stack:** NestJS, TypeScript, Jest, Prisma.

---

### Task 1: Di chuyển extraction và policies

1. Chuyển intent, structured extractor, context collector vào `extraction/`.
2. Chuyển catalog, question, safety, RAG, rate limit vào `policies/`.
3. Cập nhật import trong service, module và test.
4. Chạy test extraction/policies.

### Task 2: Di chuyển orchestration và generation

1. Chuyển guided diagnosis và session context vào `orchestration/`.
2. Chuyển Gemini và response builder vào `generation/`.
3. Cập nhật import tương đối tới constants, Prisma và các service khác.
4. Chạy test guided/response/session.

### Task 3: Di chuyển persistence

1. Chuyển conversation persistence, related history và usefulness scoring vào `persistence/`.
2. Cập nhật import Prisma/constants/scoring.
3. Chạy persistence test và service regression test.

### Task 4: Dọn orchestrator/facade

1. Xóa helper private không còn call site sau giai đoạn 1.
2. Giữ các helper còn là trách nhiệm orchestration/facade.
3. Chạy toàn bộ test `src/ai_web`.

### Task 5: Verification

1. Chạy `npm run build`.
2. Chạy `git diff --check` và kiểm tra danh sách file.
3. Xác nhận route/contract không đổi và `src/ai` không bị chỉnh sửa.
