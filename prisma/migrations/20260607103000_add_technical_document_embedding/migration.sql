CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "technical_documents"
ADD COLUMN IF NOT EXISTS "embedding" vector(768);
