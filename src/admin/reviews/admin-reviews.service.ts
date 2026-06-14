import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

type AdminReviewQuery = {
  search?: string;
  rating?: string;
  sentiment?: string;
  tag?: string;
  technicianId?: string;
  customerId?: string;
};

@Injectable()
export class AdminReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Xây dựng điều kiện truy vấn đánh giá từ bộ lọc của admin. */
  private buildWhere(query: AdminReviewQuery): Prisma.ReviewWhereInput {
    const where: Prisma.ReviewWhereInput = {};
    const and: Prisma.ReviewWhereInput[] = [];

    if (query.rating && /^\d+$/.test(query.rating)) {
      and.push({ rating: Number(query.rating) });
    }

    if (query.sentiment === 'POSITIVE') {
      and.push({ rating: { gte: 4 } });
    }

    if (query.sentiment === 'NEUTRAL') {
      and.push({ rating: 3 });
    }

    if (query.sentiment === 'NEGATIVE') {
      and.push({ rating: { lte: 2 } });
    }

    if (query.tag && query.tag !== 'ALL') {
      and.push({ tags: { has: query.tag } });
    }

    if (query.technicianId && /^\d+$/.test(query.technicianId)) {
      and.push({ technicianId: Number(query.technicianId) });
    }

    if (query.customerId && /^\d+$/.test(query.customerId)) {
      and.push({ userId: Number(query.customerId) });
    }

    if (and.length > 0) {
      where.AND = and;
    }

    return where;
  }

  /** Kiểm tra một đánh giá có khớp từ khóa tìm kiếm sau khi đã enrich dữ liệu hay không. */
  private matchesSearch(
    review: {
      id: number;
      sessionId: number;
      customerName: string;
      customerPhone: string;
      technicianName: string;
      technicianPhone: string;
      repairServiceName: string;
      comment: string | null;
    },
    search?: string,
  ) {
    const keyword = search?.trim().toLowerCase();
    if (!keyword) {
      return true;
    }

    const haystack = [
      review.id,
      review.sessionId,
      `SE-${review.sessionId}`,
      review.customerName,
      review.customerPhone,
      review.technicianName,
      review.technicianPhone,
      review.repairServiceName,
      review.comment ?? '',
    ]
      .join(' ')
      .toLowerCase();

    return haystack.includes(keyword);
  }

  /** Chuẩn hóa bản ghi review từ Prisma về shape FE admin đang cần. */
  private mapReview(review: {
    id: number;
    sessionId: number;
    userId: number;
    technicianId: number;
    rating: number;
    comment: string | null;
    tags: string[];
    createdAt: Date;
    user: { fullName: string | null; phoneNumber: string };
    technician: { fullName: string | null; phoneNumber: string };
    session: {
      deviceType: string | null;
      symptom: string | null;
      address: string | null;
    };
  }) {
    return {
      id: review.id,
      sessionId: review.sessionId,
      sessionCode: `SE-${review.sessionId}`,
      userId: review.userId,
      customerName: review.user.fullName?.trim() || `Khách #${review.userId}`,
      customerPhone: review.user.phoneNumber,
      technicianId: review.technicianId,
      technicianName:
        review.technician.fullName?.trim() || `Thợ #${review.technicianId}`,
      technicianPhone: review.technician.phoneNumber,
      rating: review.rating,
      comment: review.comment,
      tags: review.tags,
      repairServiceName:
        review.session.deviceType?.trim() ||
        review.session.symptom?.trim() ||
        'Ca sửa chữa',
      address: review.session.address?.trim() || '--',
      createdAt: review.createdAt.toISOString(),
    };
  }

  /** Lấy danh sách đánh giá cho admin và giữ bộ lọc tìm kiếm ở tầng service. */
  async getReviews(query: AdminReviewQuery) {
    const reviews = await this.prisma.review.findMany({
      where: this.buildWhere(query),
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        sessionId: true,
        userId: true,
        technicianId: true,
        rating: true,
        comment: true,
        tags: true,
        createdAt: true,
        user: {
          select: {
            fullName: true,
            phoneNumber: true,
          },
        },
        technician: {
          select: {
            fullName: true,
            phoneNumber: true,
          },
        },
        session: {
          select: {
            deviceType: true,
            symptom: true,
            address: true,
          },
        },
      },
    });

    return reviews
      .map((review) => this.mapReview(review))
      .filter((review) => this.matchesSearch(review, query.search));
  }
}
