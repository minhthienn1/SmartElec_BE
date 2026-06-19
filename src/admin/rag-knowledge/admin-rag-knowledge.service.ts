import { Injectable } from '@nestjs/common';
import { IngestDocumentDto } from '../../rag/dto/ingest-document.dto';
import { ImportRagFileDto } from '../../rag/dto/import-rag-file.dto';
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

  createDocument(dto: IngestDocumentDto) {
    return this.ragService.ingestDocument(dto);
  }

  updateDocument(id: number, dto: IngestDocumentDto) {
    return this.ragService.updateDocument(id, dto);
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
