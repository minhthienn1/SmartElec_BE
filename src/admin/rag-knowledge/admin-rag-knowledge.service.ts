import { Injectable } from '@nestjs/common';
import { ArchiveRagDocumentDto } from '../../rag/dto/archive-rag-document.dto';
import { IngestDocumentDto } from '../../rag/dto/ingest-document.dto';
import { ImportRagFileDto } from '../../rag/dto/import-rag-file.dto';
import { RagDocumentChunksQueryDto } from '../../rag/dto/rag-document-chunks-query.dto';
import { RagIngestionService } from '../../rag/rag-ingestion.service';
import { RagService } from '../../rag/rag.service';

@Injectable()
export class AdminRagKnowledgeService {
  constructor(
    private readonly ragService: RagService,
    private readonly ragIngestionService: RagIngestionService,
  ) {}

  getDocuments() {
    return this.ragService.getAllDocuments();
  }

  getStats() {
    return this.ragService.getDocumentStats();
  }

  getDocumentDetail(id: number) {
    return this.ragService.getDocumentDetail(id);
  }

  getDocumentChunks(id: number, query: RagDocumentChunksQueryDto) {
    return this.ragService.getDocumentChunks(id, query);
  }

  getChunkDetail(chunkId: number) {
    return this.ragService.getChunkDetail(chunkId);
  }

  createDocument(dto: IngestDocumentDto) {
    return this.ragService.ingestDocument(dto);
  }

  updateDocument(id: number, dto: IngestDocumentDto) {
    return this.ragService.updateDocument(id, dto);
  }

  archiveDocument(id: number, dto: ArchiveRagDocumentDto) {
    return this.ragService.archiveDocument(id, dto);
  }

  reindexDocument(id: number) {
    return this.ragService.reindexDocument(id);
  }

  deleteDocument(id: number) {
    return this.ragService.deleteDocument(id);
  }

  importDocumentFile(
    file: Express.Multer.File,
    dto: ImportRagFileDto,
    uploadedById?: number,
  ) {
    return this.ragIngestionService.importFile(file, dto, uploadedById);
  }
}
