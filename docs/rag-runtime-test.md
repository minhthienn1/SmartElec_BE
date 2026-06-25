# RAG Runtime Test

Tài liệu này dùng để kiểm thử runtime thực tế cho luồng import RAG của SmartElec sau các phase 2A-2E.

## Phạm vi

Các endpoint liên quan:

- `POST /admin/rag-knowledge/import`
- `GET /admin/rag-knowledge/documents`
- `GET /admin/rag-knowledge/documents/:id`
- `GET /admin/rag-knowledge/documents/:id/chunks`
- `GET /admin/rag-knowledge/stats`
- `GET /mechanic-ai/search`
- `POST /ai/chat`
- `GET /admin/ai-reasoning-logs/:id/retrieved-chunks`

Định dạng import hiện hỗ trợ:

- `TXT`
- `MD`
- `CSV`
- `DOCX`
- `XLSX`
- `PDF` có text layer

Chưa hỗ trợ:

- `DOC`
- `XLS`
- PDF scan ảnh
- OCR

## Chuẩn bị

Chạy backend:

```bash
npm run start:dev
```

Biến môi trường quan trọng:

- `DATABASE_URL`
- `DIRECT_URL`
- `GEMINI_API_KEY`
- biến cấu hình upload/R2 nếu môi trường đang upload file thật

JWT để test:

- `ADMIN_JWT`: dùng cho admin RAG endpoints
- `CHAT_JWT`: tùy chọn, dùng cho `POST /ai/chat`
  Nếu không có `CHAT_JWT`, script sẽ fallback sang `ADMIN_JWT`.

PowerShell:

```powershell
$env:API_BASE_URL = "http://localhost:3000"
$env:ADMIN_JWT = "your-admin-jwt"
$env:CHAT_JWT = "your-user-or-admin-jwt"
```

CMD:

```cmd
set API_BASE_URL=http://localhost:3000
set ADMIN_JWT=your-admin-jwt
set CHAT_JWT=your-user-or-admin-jwt
```

## Cấu trúc file mẫu

Thư mục mặc định cho file mẫu:

```txt
scripts/rag-test/samples/
```

Tên file gợi ý:

```txt
sample.txt
sample.md
sample.csv
sample.docx
sample.xlsx
sample.pdf
```

Có thể override bằng:

```bash
RAG_SAMPLE_DIR=/duong-dan-khac
```

## Test bằng script Node.js

Script:

```txt
scripts/rag-test/test-rag-runtime.mjs
```

Chạy:

```bash
node scripts/rag-test/test-rag-runtime.mjs
```

Script sẽ:

- đọc `ADMIN_JWT`
- đọc `API_BASE_URL`, mặc định `http://localhost:3000`
- upload từng file mẫu nếu tồn tại
- in `status`, `documentId`, `totalChunks`
- gọi `stats`
- gọi `documents`
- gọi `document detail`
- gọi `chunks`
- gọi `mechanic-ai/search`
- gọi `POST /ai/chat`
- nếu có `logId`, gọi tiếp `GET /admin/ai-reasoning-logs/:id/retrieved-chunks`

Script không fail toàn bộ nếu thiếu một file mẫu. Nó chỉ cảnh báo và bỏ qua file đó.

Biến môi trường tùy chọn thêm:

- `SEARCH_QUERY`
- `CHAT_MESSAGE`
- `CHAT_SESSION_ID`
- `RAG_SAMPLE_DIR`

Ví dụ:

```powershell
$env:SEARCH_QUERY = "máy giặt báo lỗi E1"
$env:CHAT_MESSAGE = "Máy giặt nhà tôi báo lỗi E1, nguyên nhân thường là gì?"
node scripts/rag-test/test-rag-runtime.mjs
```

## Test tay bằng curl

Lưu ý: thay `YOUR_ADMIN_JWT` bằng JWT admin thật.

### Import TXT

```bash
curl -X POST "http://localhost:3000/admin/rag-knowledge/import" \
  -H "Authorization: Bearer YOUR_ADMIN_JWT" \
  -F "title=sample-txt" \
  -F "source=manual-runtime-test" \
  -F "accessLevel=ADVANCED" \
  -F "file=@scripts/rag-test/samples/sample.txt"
```

### Import MD

```bash
curl -X POST "http://localhost:3000/admin/rag-knowledge/import" \
  -H "Authorization: Bearer YOUR_ADMIN_JWT" \
  -F "title=sample-md" \
  -F "source=manual-runtime-test" \
  -F "accessLevel=ADVANCED" \
  -F "file=@scripts/rag-test/samples/sample.md"
```

### Import CSV

```bash
curl -X POST "http://localhost:3000/admin/rag-knowledge/import" \
  -H "Authorization: Bearer YOUR_ADMIN_JWT" \
  -F "title=sample-csv" \
  -F "source=manual-runtime-test" \
  -F "accessLevel=ADVANCED" \
  -F "file=@scripts/rag-test/samples/sample.csv"
```

### Import DOCX

```bash
curl -X POST "http://localhost:3000/admin/rag-knowledge/import" \
  -H "Authorization: Bearer YOUR_ADMIN_JWT" \
  -F "title=sample-docx" \
  -F "source=manual-runtime-test" \
  -F "accessLevel=ADVANCED" \
  -F "file=@scripts/rag-test/samples/sample.docx"
```

### Import XLSX

```bash
curl -X POST "http://localhost:3000/admin/rag-knowledge/import" \
  -H "Authorization: Bearer YOUR_ADMIN_JWT" \
  -F "title=sample-xlsx" \
  -F "source=manual-runtime-test" \
  -F "accessLevel=ADVANCED" \
  -F "file=@scripts/rag-test/samples/sample.xlsx"
```

### Import PDF text

```bash
curl -X POST "http://localhost:3000/admin/rag-knowledge/import" \
  -H "Authorization: Bearer YOUR_ADMIN_JWT" \
  -F "title=sample-pdf" \
  -F "source=manual-runtime-test" \
  -F "accessLevel=ADVANCED" \
  -F "file=@scripts/rag-test/samples/sample.pdf"
```

## Test tay bằng PowerShell

```powershell
$headers = @{ Authorization = "Bearer $env:ADMIN_JWT" }

curl.exe -X POST "http://localhost:3000/admin/rag-knowledge/import" `
  -H "Authorization: Bearer $env:ADMIN_JWT" `
  -F "title=sample-txt" `
  -F "source=manual-runtime-test" `
  -F "accessLevel=ADVANCED" `
  -F "file=@scripts/rag-test/samples/sample.txt"
```

Lặp lại tương tự cho `sample.md`, `sample.csv`, `sample.docx`, `sample.xlsx`, `sample.pdf`.

## Kiểm tra document list, detail, chunks, stats

### List documents

```bash
curl -H "Authorization: Bearer YOUR_ADMIN_JWT" \
  "http://localhost:3000/admin/rag-knowledge/documents"
```

### Document detail

```bash
curl -H "Authorization: Bearer YOUR_ADMIN_JWT" \
  "http://localhost:3000/admin/rag-knowledge/documents/123"
```

### Chunks

```bash
curl -H "Authorization: Bearer YOUR_ADMIN_JWT" \
  "http://localhost:3000/admin/rag-knowledge/documents/123/chunks?page=1&limit=10"
```

### Stats

```bash
curl -H "Authorization: Bearer YOUR_ADMIN_JWT" \
  "http://localhost:3000/admin/rag-knowledge/stats"
```

## Test `mechanic-ai/search`

```bash
curl "http://localhost:3000/mechanic-ai/search?q=máy%20lạnh%20không%20mát&level=ADVANCED&limit=5"
```

## Test `POST /ai/chat`

Lưu ý: endpoint này cần JWT hợp lệ của người dùng hoặc admin.

```bash
curl -X POST "http://localhost:3000/ai/chat" \
  -H "Authorization: Bearer YOUR_CHAT_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Máy lạnh chạy nhưng không mát, có thể kiểm tra giúp tôi không?",
    "history": []
  }'
```

Kết quả thành công thường có:

- `text`
- `state`
- `sessionId`
- `logId`

Sau đó kiểm tra retrieved chunks:

```bash
curl -H "Authorization: Bearer YOUR_ADMIN_JWT" \
  "http://localhost:3000/admin/ai-reasoning-logs/LOG_ID/retrieved-chunks"
```

## Kiểm tra DB bằng SQL

### RagDocument mới nhất

```sql
SELECT
  id,
  title,
  status,
  "fileType",
  "originalFileName",
  "totalChunks",
  "totalCharacters",
  "totalTokens",
  "errorMessage",
  "createdAt",
  "indexedAt"
FROM rag_documents
ORDER BY id DESC
LIMIT 10;
```

### RagChunk mới nhất

```sql
SELECT
  id,
  "documentId",
  "chunkIndex",
  title,
  section,
  "charCount",
  "tokenCount",
  "isActive",
  "createdAt"
FROM rag_chunks
ORDER BY id DESC
LIMIT 20;
```

### AiReasoningLog mới nhất

```sql
SELECT
  id,
  "userId",
  "sessionId",
  "riskLevel",
  score,
  "deviceCategory",
  "createdAt"
FROM ai_reasoning_logs
ORDER BY id DESC
LIMIT 20;
```

### AiRetrievedChunk mới nhất

```sql
SELECT
  arc.id,
  arc."logId",
  arc."chunkId",
  arc.score,
  arc.rank,
  arc."createdAt"
FROM ai_retrieved_chunks arc
ORDER BY arc.id DESC
LIMIT 20;
```

### Join để xem chunk nào vừa được AI dùng

```sql
SELECT
  arc."logId",
  arc."chunkId",
  arc.score,
  arc.rank,
  rc."documentId",
  rc."chunkIndex",
  rd.title AS document_title
FROM ai_retrieved_chunks arc
JOIN rag_chunks rc ON rc.id = arc."chunkId"
JOIN rag_documents rd ON rd.id = rc."documentId"
ORDER BY arc.id DESC
LIMIT 20;
```

## Lỗi thường gặp

### PDF scan cần OCR

Triệu chứng:

- import PDF báo không có text hợp lệ

Nguyên nhân:

- PDF là ảnh scan, không có text layer

Trạng thái hiện tại:

- hệ thống chưa hỗ trợ OCR

### File quá lớn

Triệu chứng:

- bị chặn bởi `MAX_FILE_SIZE_BYTES`
- hoặc parse xong vượt `MAX_PARSED_TEXT_CHARS`

### File trùng checksum

Triệu chứng:

- import trả lỗi duplicate

Nguyên nhân:

- file đã tồn tại trong kho tri thức RAG và đang active

### Thiếu `GEMINI_API_KEY`

Triệu chứng:

- import parse/chunk xong nhưng fail ở bước embedding
- `POST /ai/chat` fail khi gọi model

### Lỗi R2/upload

Triệu chứng:

- import fail trước khi parse

Nguyên nhân:

- cấu hình upload object storage chưa đúng

### Token hết hạn

Triệu chứng:

- `401 Unauthorized`

Nguyên nhân:

- `ADMIN_JWT` hoặc `CHAT_JWT` không còn hợp lệ

## Gợi ý quy trình test nhanh

1. Chạy backend.
2. Set `ADMIN_JWT` và `CHAT_JWT`.
3. Chuẩn bị ít nhất 1 file mẫu trong `scripts/rag-test/samples/`.
4. Chạy:

```bash
node scripts/rag-test/test-rag-runtime.mjs
```

5. Nếu cần điều tra sâu hơn, dùng SQL hoặc:

```bash
GET /admin/ai-reasoning-logs/:id/retrieved-chunks
```
