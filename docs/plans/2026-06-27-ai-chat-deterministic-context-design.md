# AI Chat Deterministic Context Design

**Mục tiêu:** Chuyển flow `/api/ai/chat` sang backend orchestration deterministic để bot hỏi context theo nhóm thiết bị, tránh hỏi lặp, và chỉ vào RAG khi đủ dữ liệu tối thiểu.

## Phạm vi

- Sửa backend AI flow trong `src/ai`.
- Mở rộng nhẹ FE state ở `useChatbotApi.ts` và common types để không làm rơi field mới.
- Không sửa Prisma schema.
- Không sửa Mobile.
- Không sửa `/chat/upload`.
- Không nối `useRepairChat` vào `/chatbot`.

## Contract state mới

`state` của `/api/ai/chat` sẽ giữ thêm:

- `deviceCategory`
- `contextQuestionsAsked`
- `contextQuestionSet`
- `contextAnswers`
- `askedFollowupKey`
- `phase`

## Quy tắc chính

1. Chưa có `device` thì chỉ hỏi lại thiết bị.
2. Có `device + symptom` thì backend chọn đúng bộ 3 câu theo `deviceCategory`.
3. `contextQuestionsAsked` chỉ có ý nghĩa khi `contextQuestionSet` còn khớp với `deviceCategory + symptom`.
4. Đã hỏi 3 câu thì không hỏi lại nguyên bộ; nếu thiếu, chỉ hỏi 1 follow-up quan trọng nhất.
5. Chỉ vào RAG/tư vấn khi có `device + symptom + ít nhất 1 context answer` trong nhóm tín hiệu tối thiểu.
6. Nếu có `safetySigns` hoặc `risk = HIGH/RED`, prepend cảnh báo an toàn trước.
7. Một session chỉ tư vấn một thiết bị; device switch bị chặn ở cả FE và backend.

## Hướng kỹ thuật

- `ai-intent-gate.service.ts`: mở rộng detect thiết bị/triệu chứng cho nhiều nhóm thiết bị.
- `ai-guided-diagnosis.service.ts`: engine deterministic chứa:
  - mapping `deviceCategory`
  - bộ 3 câu theo category
  - merge `contextAnswers`
  - anti-repeat
  - follow-up 1 câu
  - gate vào RAG
- `ai.service.ts`: đổi orchestration để guided diagnosis chạy trước RAG retrieval.
- `ai.constants.ts`: mở rộng fallback state và response schema.
- FE giữ state nhẹ, không tự quyết định flow AI.
