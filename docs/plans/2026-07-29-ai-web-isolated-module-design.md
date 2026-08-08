# AI Web Isolated Module Design

> Thiết kế này tách riêng backend AI cho web khỏi module `src/ai` đang phục vụ mobile.

## Mục tiêu

- Giữ nguyên toàn bộ `src/ai` để không ảnh hưởng mobile.
- Tạo `src/ai_web` riêng cho web với route riêng.
- Sửa các vấn đề backend của web trong nhánh mới:
  - gate booking chỉ theo `risk === RED`
  - không để AI tự quyết định booking thật
  - giữ dữ liệu đủ để web reload/session history không bị "mất chat"
  - trả summary cuối phiên cho web

## Kiến trúc

- Tạo module mới `AiWebModule` trong `src/ai_web`.
- Copy mã từ `src/ai` sang `src/ai_web`, sau đó chỉ sửa trong `src/ai_web`.
- Web gọi route mới `/api/ai-web/...`.
- Mobile tiếp tục dùng `/api/ai/...` cũ.

## Phạm vi sửa

- Tạo controller/service/module mới trong `src/ai_web`.
- Đăng ký `AiWebModule` vào `app.module.ts`.
- Chỉnh flow AI web:
  - response có `canBook`
  - response có `chatClosed`/`finalAiSummary`/`symptomLabel`
- Chỉnh `chats.service.ts` ở phần đọc session/messages để web history hydrate đúng hơn mà không đụng `src/ai`.

## Quyết định thiết kế

### 1. Booking thật chỉ đến từ API booking

- `ai_web` có thể gợi ý đặt thợ.
- `ai_web` không được xem AI text hoặc `is_booking_triggered` là booking đã xảy ra.
- Session chỉ đóng khi booking API thật thành công.

### 2. Web cần summary cuối phiên

- Transcript AI vẫn nên được giữ để web có thể dùng lại nếu cần.
- Đồng thời backend cần trả thêm summary cuối phiên để FE web có thể render màn closed-session gọn như mobile.

### 3. Không sửa `src/ai`

- Không đổi controller/service/module ở `src/ai`.
- Không đổi route `/api/ai/...`.

## Dữ liệu web cần khi reload

- `latestAiLogId`
- `latestAiFeedback`
- `chatClosed`
- `canBook`
- `risk`
- `symptomLabel`
- `finalAiSummary`

## Rủi ro chấp nhận

- Có duplicate code giữa `src/ai` và `src/ai_web`.
- Đây là đánh đổi có chủ đích để giảm rủi ro làm hỏng mobile.
