# AI Chat Deterministic Context Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Chuyển `/api/ai/chat` sang flow hỏi context deterministic theo nhóm thiết bị, tránh hỏi lặp, và preserve state mới ở FE.

**Architecture:** Backend quyết định toàn bộ flow hỏi context, merge contextAnswers, chặn device switch và gate vào RAG. FE chỉ merge state nhẹ từ backend để giữ conversation state ổn định qua nhiều lượt chat.

**Tech Stack:** NestJS, Prisma, Jest, Next.js, TypeScript, React hooks

---

### Task 1: Viết test cho deterministic diagnosis

**Files:**
- Create: `BE_Backup/SmartElec_BE/src/ai/ai-guided-diagnosis.service.spec.ts`
- Modify: `BE_Backup/SmartElec_BE/src/ai/ai-guided-diagnosis.service.ts`

**Step 1:** Viết test fail cho các case hỏi 3 câu, anti-repeat, ambiguity và gate vào RAG.  
**Step 2:** Chạy `npm test -- ai-guided-diagnosis.service.spec.ts` để thấy test fail đúng lý do.  
**Step 3:** Implement minimal deterministic engine để pass test.  
**Step 4:** Chạy lại test.

### Task 2: Đổi orchestration `/api/ai/chat`

**Files:**
- Modify: `BE_Backup/SmartElec_BE/src/ai/ai.service.ts`
- Modify: `BE_Backup/SmartElec_BE/src/ai/ai-intent-gate.service.ts`
- Modify: `BE_Backup/SmartElec_BE/src/ai/ai.constants.ts`
- Modify: `BE_Backup/SmartElec_BE/src/ai/ai-response-builder.service.ts`

**Step 1:** Cho guided diagnosis chạy trước branch RAG.  
**Step 2:** Dùng query RAG giàu context hơn từ `device + symptom + contextAnswers`.  
**Step 3:** Thêm state/schema mới và cảnh báo an toàn prepend.  
**Step 4:** Chạy build/test mục tiêu cho backend.

### Task 3: Mở rộng FE state nhẹ

**Files:**
- Modify: `FE/AI_ChatBot_TuVanSuaChuaDien_Website/fe_chatbot_website/app/services/common/types.ts`
- Modify: `FE/AI_ChatBot_TuVanSuaChuaDien_Website/fe_chatbot_website/app/services/chatbot.service.ts`
- Modify: `FE/AI_ChatBot_TuVanSuaChuaDien_Website/fe_chatbot_website/app/hooks/useChatbotApi.ts`

**Step 1:** Thêm type cho state mới.  
**Step 2:** Merge `contextAnswers` theo shallow merge, không xóa dữ liệu cũ bằng `null/undefined`.  
**Step 3:** Giữ nguyên logic device switch FE hiện có.  
**Step 4:** Chạy lint/build FE nếu môi trường cho phép.
