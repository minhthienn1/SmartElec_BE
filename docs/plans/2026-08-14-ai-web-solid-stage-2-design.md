# Thiết kế AI Web SOLID giai đoạn 2

## Mục tiêu

Tổ chức lại `src/ai_web` theo trách nhiệm để dễ tìm, sửa và kiểm thử mà không đổi route, API contract hoặc hành vi chatbot.

## Cấu trúc

```text
src/ai_web/
├── extraction/      # intent, structured extractor, context collector
├── orchestration/   # deterministic diagnosis, session context
├── policies/        # device catalog, question, safety, RAG, rate limit
├── generation/      # Gemini và response builder
├── persistence/     # transcript, reasoning log, history, scoring
├── ai.constants.ts
├── ai.controller.ts
├── ai.module.ts
└── ai.service.ts    # facade
```

## Nguyên tắc

- Giữ nguyên `AiController`, route `/api/ai-web/*` và response contract.
- Giữ `AiService` làm facade, `AiGuidedDiagnosisService` làm orchestrator.
- Không dùng barrel export; import trực tiếp để dependency rõ ràng.
- Di chuyển test cùng service.
- Dọn helper cũ chỉ sau khi call site đã delegate sang service mới.
- Không chỉnh sửa `src/ai` dành cho mobile.

## Kiểm chứng

- Search toàn bộ import trước và sau khi di chuyển.
- Chạy từng nhóm test sau mỗi nhóm folder.
- Chạy toàn bộ test `src/ai_web` và `npm run build`.
- Kiểm tra `git diff --check` và xác nhận `src/ai` không thay đổi.
