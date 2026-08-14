# AI Web SOLID Stage 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Tách các policy thuần và context handling khỏi các service lớn trong `src/ai_web` mà không đổi route, contract hoặc hành vi chatbot.

**Architecture:** Giữ `AiService` làm facade và `AiGuidedDiagnosisService` làm deterministic orchestrator. Các service mới chỉ đảm nhiệm một nhóm trách nhiệm: catalog thiết bị, thu thập context, chính sách câu hỏi, an toàn, RAG và session context.

**Tech Stack:** NestJS, TypeScript, Jest, Prisma.

---

### Task 1: Catalog thiết bị web

**Files:**
- Create: `src/ai_web/ai-web-device-catalog.service.ts`
- Create: `src/ai_web/ai-web-device-catalog.service.spec.ts`
- Modify: `src/ai_web/ai.module.ts`
- Modify: `src/ai_web/ai-intent-gate.service.ts`
- Modify: `src/ai_web/ai-structured-extractor.service.ts`
- Modify: `src/ai_web/ai.service.ts`

1. Viết test fail cho resolve alias, thiết bị ngoài phạm vi và đếm thiết bị.
2. Chạy test để xác nhận fail do service chưa tồn tại.
3. Cài đặt catalog tối thiểu và đăng ký DI.
4. Thay logic alias trùng bằng catalog nhưng giữ nguyên output.
5. Chạy test catalog và các test intent/extractor/service.

### Task 2: Context collector và question policy

**Files:**
- Create: `src/ai_web/ai-context-collector.service.ts`
- Create: `src/ai_web/ai-context-collector.service.spec.ts`
- Create: `src/ai_web/ai-question-policy.service.ts`
- Create: `src/ai_web/ai-question-policy.service.spec.ts`
- Modify: `src/ai_web/ai-guided-diagnosis.service.ts`
- Modify: `src/ai_web/ai.module.ts`

1. Viết test fail từ các case đang pass trong guided diagnosis.
2. Tách extraction/merge context và chọn follow-up.
3. Tách question set/template/message.
4. Delegate từ guided diagnosis sang các service mới.
5. Chạy unit test mới và guided diagnosis regression test.

### Task 3: Safety policy và RAG policy

**Files:**
- Create: `src/ai_web/ai-safety-policy.service.ts`
- Create: `src/ai_web/ai-safety-policy.service.spec.ts`
- Create: `src/ai_web/ai-rag-policy.service.ts`
- Create: `src/ai_web/ai-rag-policy.service.spec.ts`
- Modify: `src/ai_web/ai-guided-diagnosis.service.ts`
- Modify: `src/ai_web/ai.module.ts`

1. Viết test fail cho safety warning và RAG gate.
2. Tách detection/rendering cảnh báo.
3. Tách điều kiện vào RAG và xây query.
4. Delegate từ guided diagnosis.
5. Chạy test policy và regression test.

### Task 4: Session context

**Files:**
- Create: `src/ai_web/ai-session-context.service.ts`
- Create: `src/ai_web/ai-session-context.service.spec.ts`
- Modify: `src/ai_web/ai.service.ts`
- Modify: `src/ai_web/ai.module.ts`

1. Viết test fail cho chuẩn hóa context phiên.
2. Tách đọc context, build context và seed previous state.
3. Delegate từ `AiService`.
4. Chạy test service và regression test.

### Task 5: Verification

1. Chạy toàn bộ test `src/ai_web`.
2. Chạy `npm run build`.
3. Kiểm tra `git diff --stat`, `git diff --check` và diff từng file.
4. Xác nhận không có thay đổi trong `src/ai` và không đổi API contract.
