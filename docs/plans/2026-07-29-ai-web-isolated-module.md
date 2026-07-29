# AI Web Isolated Module Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Tạo module `ai_web` riêng cho website, giữ nguyên `src/ai` cho mobile và vá các vấn đề backend của web trong module mới.

**Architecture:** Copy `src/ai` sang `src/ai_web`, đăng ký route `/api/ai-web/...`, sau đó sửa riêng controller/service/persistence/summary cho web. Chỉ chạm `app.module.ts` và các file mới trong `src/ai_web`, cộng với chỉnh có kiểm soát ở `chats.service.ts` để hydrate session web đúng hơn.

**Tech Stack:** NestJS, Prisma, Gemini API, existing Chats module.

---

### Task 1: Tạo module `ai_web`

**Files:**
- Create: `src/ai_web/*`
- Modify: `src/app.module.ts`

**Step 1:** Copy toàn bộ `src/ai` sang `src/ai_web`.

**Step 2:** Đổi module export trong bản copy thành `AiWebModule`.

**Step 3:** Đăng ký `AiWebModule` vào `app.module.ts`.

### Task 2: Tạo route riêng cho web

**Files:**
- Modify: `src/ai_web/ai.controller.ts`

**Step 1:** Đổi `@Controller('ai')` thành `@Controller('ai-web')`.

**Step 2:** Giữ route chat/feedback riêng cho web, không đổi route cũ của mobile.

### Task 3: Vá flow AI web

**Files:**
- Modify: `src/ai_web/ai.service.ts`
- Modify: `src/ai_web/ai-conversation-persistence.service.ts`

**Step 1:** Tách booking suggestion khỏi booking thật.

**Step 2:** Trả thêm metadata web-friendly như `canBook`, `symptomLabel`, `finalAiSummary`.

**Step 3:** Đảm bảo transcript/session summary được persist đủ cho web reload.

### Task 4: Vá hydrate session/history cho web

**Files:**
- Modify: `src/chats/chats.service.ts`

**Step 1:** Bổ sung metadata summary cuối phiên cho `getSessionById`.

**Step 2:** Điều chỉnh logic message/session để web không bị cảm giác mất transcript sau khi session đóng.

### Task 5: Kiểm tra

**Files:**
- Verify: `src/ai_web/*`
- Verify: `src/chats/chats.service.ts`

**Step 1:** Chạy build backend.

**Step 2:** Kiểm tra `git diff --stat` và `git diff --check`.

**Step 3:** Tổng hợp file đã sửa và rủi ro còn lại.
