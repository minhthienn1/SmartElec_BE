import { Injectable } from '@nestjs/common';
import { IngestDocumentDto } from '../../rag/dto/ingest-document.dto';
import { RagService } from '../../rag/rag.service';

@Injectable()
export class AdminRagKnowledgeService {
  constructor(private readonly ragService: RagService) {}

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
}
