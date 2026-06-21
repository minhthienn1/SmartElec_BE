import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_BASE_URL = (
  process.env.API_BASE_URL || 'http://localhost:3000'
).replace(/\/+$/, '');
const ADMIN_JWT = process.env.ADMIN_JWT || '';
const CHAT_JWT = process.env.CHAT_JWT || ADMIN_JWT;
const SAMPLE_DIR = process.env.RAG_SAMPLE_DIR
  ? path.resolve(process.cwd(), process.env.RAG_SAMPLE_DIR)
  : path.join(__dirname, 'samples');
const SEARCH_QUERY = process.env.SEARCH_QUERY || 'máy lạnh không mát';
const CHAT_MESSAGE =
  process.env.CHAT_MESSAGE ||
  'Máy lạnh nhà tôi chạy nhưng không mát, có thể kiểm tra giúp tôi không?';
const CHAT_SESSION_ID = process.env.CHAT_SESSION_ID || '';

const sampleFiles = [
  { label: 'TXT', filename: 'sample.txt' },
  { label: 'MD', filename: 'sample.md' },
  { label: 'CSV', filename: 'sample.csv' },
  { label: 'DOCX', filename: 'sample.docx' },
  { label: 'XLSX', filename: 'sample.xlsx' },
  { label: 'PDF', filename: 'sample.pdf' },
];

function logStep(message) {
  console.log(`\n=== ${message} ===`);
}

function logWarn(message) {
  console.warn(`[WARN] ${message}`);
}

function logInfo(message) {
  console.log(`[INFO] ${message}`);
}

async function fileExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const rawText = await response.text();

  let body = null;
  try {
    body = rawText ? JSON.parse(rawText) : null;
  } catch {
    body = rawText;
  }

  return {
    ok: response.ok,
    status: response.status,
    body,
  };
}

function buildAuthHeaders(token) {
  if (!token) {
    return {};
  }

  return {
    Authorization: `Bearer ${token}`,
  };
}

function getDocumentId(payload) {
  return (
    payload?.document?.id ??
    payload?.data?.id ??
    payload?.id ??
    null
  );
}

function getTotalChunks(payload) {
  return payload?.document?.totalChunks ?? payload?.data?.totalChunks ?? null;
}

async function uploadSample(sample) {
  const fullPath = path.join(SAMPLE_DIR, sample.filename);
  if (!(await fileExists(fullPath))) {
    logWarn(`Không tìm thấy file mẫu ${sample.filename}, bỏ qua.`);
    return null;
  }

  if (!ADMIN_JWT) {
    logWarn(`Thiếu ADMIN_JWT, không thể upload ${sample.filename}.`);
    return null;
  }

  const fileBuffer = await readFile(fullPath);
  const form = new FormData();
  form.append('title', path.parse(sample.filename).name);
  form.append('source', 'rag-runtime-script');
  form.append('accessLevel', 'ADVANCED');
  form.append(
    'file',
    new Blob([fileBuffer]),
    sample.filename,
  );

  const result = await requestJson(
    `${API_BASE_URL}/admin/rag-knowledge/import`,
    {
      method: 'POST',
      headers: buildAuthHeaders(ADMIN_JWT),
      body: form,
    },
  );

  const documentId = getDocumentId(result.body);
  const totalChunks = getTotalChunks(result.body);
  const status =
    result.body?.document?.status ?? result.body?.data?.status ?? 'unknown';

  if (result.ok) {
    logInfo(
      `${sample.label}: status=${result.status}, documentId=${documentId}, totalChunks=${totalChunks}, documentStatus=${status}`,
    );
  } else {
    logWarn(
      `${sample.label}: upload lỗi status=${result.status}, body=${JSON.stringify(result.body)}`,
    );
  }

  return {
    sample,
    fullPath,
    result,
    documentId,
  };
}

async function fetchAdminEndpoint(label, endpoint) {
  if (!ADMIN_JWT) {
    logWarn(`Thiếu ADMIN_JWT, bỏ qua ${label}.`);
    return null;
  }

  const result = await requestJson(`${API_BASE_URL}${endpoint}`, {
    headers: buildAuthHeaders(ADMIN_JWT),
  });

  if (result.ok) {
    logInfo(`${label}: status=${result.status}`);
  } else {
    logWarn(`${label}: status=${result.status}, body=${JSON.stringify(result.body)}`);
  }

  return result;
}

async function main() {
  logStep('RAG Runtime Test');
  logInfo(`API_BASE_URL=${API_BASE_URL}`);
  logInfo(`SAMPLE_DIR=${SAMPLE_DIR}`);

  logStep('Import sample files');
  const uploads = [];
  for (const sample of sampleFiles) {
    uploads.push(await uploadSample(sample));
  }

  const uploadedDocuments = uploads.filter(
    (item) => item?.result?.ok && item.documentId,
  );

  logStep('Check admin stats');
  await fetchAdminEndpoint('GET /admin/rag-knowledge/stats', '/admin/rag-knowledge/stats');

  logStep('Check document list');
  const documentListResult = await fetchAdminEndpoint(
    'GET /admin/rag-knowledge/documents',
    '/admin/rag-knowledge/documents',
  );

  const fallbackDocumentId =
    uploadedDocuments[0]?.documentId ??
    documentListResult?.body?.[0]?.id ??
    null;

  if (fallbackDocumentId) {
    logStep(`Check document detail #${fallbackDocumentId}`);
    await fetchAdminEndpoint(
      `GET /admin/rag-knowledge/documents/${fallbackDocumentId}`,
      `/admin/rag-knowledge/documents/${fallbackDocumentId}`,
    );

    logStep(`Check document chunks #${fallbackDocumentId}`);
    await fetchAdminEndpoint(
      `GET /admin/rag-knowledge/documents/${fallbackDocumentId}/chunks`,
      `/admin/rag-knowledge/documents/${fallbackDocumentId}/chunks?page=1&limit=5`,
    );
  } else {
    logWarn('Không có documentId nào để test detail/chunks.');
  }

  logStep('Check mechanic-ai search');
  const searchParams = new URLSearchParams({
    q: SEARCH_QUERY,
    level: 'ADVANCED',
    limit: '5',
  });
  const mechanicSearchResult = await requestJson(
    `${API_BASE_URL}/mechanic-ai/search?${searchParams.toString()}`,
  );
  if (mechanicSearchResult.ok) {
    const count = Array.isArray(mechanicSearchResult.body?.results)
      ? mechanicSearchResult.body.results.length
      : 0;
    logInfo(
      `GET /mechanic-ai/search: status=${mechanicSearchResult.status}, results=${count}`,
    );
  } else {
    logWarn(
      `GET /mechanic-ai/search: status=${mechanicSearchResult.status}, body=${JSON.stringify(mechanicSearchResult.body)}`,
    );
  }

  logStep('Check AI chat and retrieved chunks');
  if (!CHAT_JWT) {
    logWarn('Thiếu CHAT_JWT hoặc ADMIN_JWT, bỏ qua POST /ai/chat.');
    return;
  }

  const chatPayload = {
    message: CHAT_MESSAGE,
    history: [],
    ...(CHAT_SESSION_ID ? { sessionId: Number(CHAT_SESSION_ID) } : {}),
  };

  const chatResult = await requestJson(`${API_BASE_URL}/ai/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...buildAuthHeaders(CHAT_JWT),
    },
    body: JSON.stringify(chatPayload),
  });

  if (!chatResult.ok) {
    logWarn(
      `POST /ai/chat: status=${chatResult.status}, body=${JSON.stringify(chatResult.body)}`,
    );
    return;
  }

  const logId = chatResult.body?.logId ?? null;
  const sessionId = chatResult.body?.sessionId ?? null;
  logInfo(
    `POST /ai/chat: status=${chatResult.status}, logId=${logId}, sessionId=${sessionId}`,
  );

  if (logId && ADMIN_JWT) {
    await fetchAdminEndpoint(
      `GET /admin/ai-reasoning-logs/${logId}/retrieved-chunks`,
      `/admin/ai-reasoning-logs/${logId}/retrieved-chunks`,
    );
  } else if (!logId) {
    logWarn('POST /ai/chat không trả logId, hãy kiểm tra response hoặc log backend.');
  }
}

main().catch((error) => {
  console.error('[ERROR] Script test RAG thất bại:', error);
  process.exitCode = 1;
});
