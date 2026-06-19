/*
  Warnings:

  - A unique constraint covering the columns `[zaloId]` on the table `users` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[googleId]` on the table `users` will be added. If there are existing duplicate values, this will fail.

*/

CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('AI_CONSULTING', 'BROADCASTING', 'MATCHED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('TEXT', 'IMAGE', 'VIDEO', 'QUOTE_CARD', 'SYSTEM_LOG', 'QUOTE_RESPONSE');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'SUPERSEDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AssignmentAction" AS ENUM ('ASSIGNED', 'UNASSIGNED', 'REJECTED', 'MANUAL_CANCEL', 'SYSTEM_AUTO_CANCEL');

-- CreateEnum
CREATE TYPE "AccessLevel" AS ENUM ('BASIC', 'ADVANCED');

-- CreateEnum
CREATE TYPE "RagDocumentStatus" AS ENUM ('UPLOADED', 'PARSING', 'CHUNKING', 'EMBEDDING', 'READY', 'FAILED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RagFileType" AS ENUM ('PDF', 'DOCX', 'XLSX', 'XLS', 'CSV', 'TXT', 'MD', 'HTML', 'JSON', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "RagDocumentKind" AS ENUM ('TROUBLESHOOTING_GUIDE', 'REPAIR_POLICY', 'PRICE_TABLE', 'DEVICE_MANUAL', 'FAQ', 'INTERNAL_NOTE');

-- AlterTable
ALTER TABLE "chat_sessions" ADD COLUMN     "address" TEXT,
ADD COLUMN     "contactName" TEXT,
ADD COLUMN     "contactPhone" TEXT,
ADD COLUMN     "isHiddenByCustomer" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "status" "JobStatus" NOT NULL DEFAULT 'AI_CONSULTING',
ADD COLUMN     "technicianId" INTEGER,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "averageRating" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
ADD COLUMN     "fcmToken" TEXT,
ADD COLUMN     "googleId" TEXT,
ADD COLUMN     "isOnline" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "needsPassword" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "totalReviews" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "zaloId" TEXT;

-- CreateTable
CREATE TABLE "reviews" (
    "id" SERIAL NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "technicianId" INTEGER NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "tags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" SERIAL NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "senderId" INTEGER,
    "type" "MessageType" NOT NULL DEFAULT 'TEXT',
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" SERIAL NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "technicianId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "parentQuoteId" INTEGER,
    "acceptedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_assignment_history" (
    "id" SERIAL NOT NULL,
    "chatSessionId" INTEGER NOT NULL,
    "technicianId" INTEGER NOT NULL,
    "action" "AssignmentAction" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_assignment_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_reasoning_logs" (
    "id" SERIAL NOT NULL,
    "sessionId" INTEGER,
    "userId" INTEGER NOT NULL,
    "userMsg" TEXT NOT NULL,
    "prevState" JSONB,
    "nextState" JSONB,
    "riskLevel" TEXT,
    "aiResponse" TEXT,
    "aiFeedback" TEXT,
    "score" INTEGER NOT NULL DEFAULT 0,
    "deviceCategory" TEXT,
    "isGolden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_reasoning_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rag_documents" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "originalFileName" TEXT,
    "storedFileName" TEXT,
    "fileUrl" TEXT,
    "storageKey" TEXT,
    "mimeType" TEXT,
    "fileType" "RagFileType" NOT NULL DEFAULT 'UNKNOWN',
    "fileSizeBytes" BIGINT,
    "checksum" TEXT,
    "kind" "RagDocumentKind",
    "category" TEXT,
    "brand" TEXT,
    "modelCode" TEXT,
    "source" TEXT,
    "tags" TEXT[],
    "accessLevel" "AccessLevel" NOT NULL DEFAULT 'ADVANCED',
    "status" "RagDocumentStatus" NOT NULL DEFAULT 'UPLOADED',
    "errorMessage" TEXT,
    "totalChunks" INTEGER NOT NULL DEFAULT 0,
    "totalCharacters" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "uploadedById" INTEGER,
    "parsedAt" TIMESTAMP(3),
    "indexedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rag_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rag_chunks" (
    "id" SERIAL NOT NULL,
    "documentId" INTEGER NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "title" TEXT,
    "section" TEXT,
    "content" TEXT NOT NULL,
    "pageNumber" INTEGER,
    "sheetName" TEXT,
    "rowIndex" INTEGER,
    "metadata" JSONB,
    "category" TEXT,
    "brand" TEXT,
    "modelCode" TEXT,
    "tags" TEXT[],
    "accessLevel" "AccessLevel" NOT NULL DEFAULT 'ADVANCED',
    "tokenCount" INTEGER,
    "charCount" INTEGER,
    "embedding" vector(768),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rag_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_retrieved_chunks" (
    "id" SERIAL NOT NULL,
    "logId" INTEGER NOT NULL,
    "chunkId" INTEGER NOT NULL,
    "score" DOUBLE PRECISION,
    "rank" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_retrieved_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "technical_documents" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT,
    "source" TEXT,
    "embedding" vector(768),
    "accessLevel" "AccessLevel" NOT NULL DEFAULT 'ADVANCED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "technical_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reviews_sessionId_key" ON "reviews"("sessionId");

-- CreateIndex
CREATE INDEX "rag_documents_status_idx" ON "rag_documents"("status");

-- CreateIndex
CREATE INDEX "rag_documents_category_idx" ON "rag_documents"("category");

-- CreateIndex
CREATE INDEX "rag_documents_brand_idx" ON "rag_documents"("brand");

-- CreateIndex
CREATE INDEX "rag_documents_kind_idx" ON "rag_documents"("kind");

-- CreateIndex
CREATE INDEX "rag_documents_accessLevel_idx" ON "rag_documents"("accessLevel");

-- CreateIndex
CREATE INDEX "rag_documents_isActive_idx" ON "rag_documents"("isActive");

-- CreateIndex
CREATE INDEX "rag_documents_uploadedById_idx" ON "rag_documents"("uploadedById");

-- CreateIndex
CREATE INDEX "rag_documents_checksum_idx" ON "rag_documents"("checksum");

-- CreateIndex
CREATE INDEX "rag_chunks_documentId_idx" ON "rag_chunks"("documentId");

-- CreateIndex
CREATE INDEX "rag_chunks_category_idx" ON "rag_chunks"("category");

-- CreateIndex
CREATE INDEX "rag_chunks_brand_idx" ON "rag_chunks"("brand");

-- CreateIndex
CREATE INDEX "rag_chunks_accessLevel_idx" ON "rag_chunks"("accessLevel");

-- CreateIndex
CREATE INDEX "rag_chunks_isActive_idx" ON "rag_chunks"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "rag_chunks_documentId_chunkIndex_key" ON "rag_chunks"("documentId", "chunkIndex");

-- CreateIndex
CREATE INDEX "ai_retrieved_chunks_logId_idx" ON "ai_retrieved_chunks"("logId");

-- CreateIndex
CREATE INDEX "ai_retrieved_chunks_chunkId_idx" ON "ai_retrieved_chunks"("chunkId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_retrieved_chunks_logId_chunkId_key" ON "ai_retrieved_chunks"("logId", "chunkId");

-- CreateIndex
CREATE UNIQUE INDEX "users_zaloId_key" ON "users"("zaloId");

-- CreateIndex
CREATE UNIQUE INDEX "users_googleId_key" ON "users"("googleId");

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_assignment_history" ADD CONSTRAINT "session_assignment_history_chatSessionId_fkey" FOREIGN KEY ("chatSessionId") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_assignment_history" ADD CONSTRAINT "session_assignment_history_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rag_documents" ADD CONSTRAINT "rag_documents_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rag_chunks" ADD CONSTRAINT "rag_chunks_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "rag_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_retrieved_chunks" ADD CONSTRAINT "ai_retrieved_chunks_logId_fkey" FOREIGN KEY ("logId") REFERENCES "ai_reasoning_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_retrieved_chunks" ADD CONSTRAINT "ai_retrieved_chunks_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "rag_chunks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
