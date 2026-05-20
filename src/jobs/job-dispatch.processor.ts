import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { Logger } from '@nestjs/common';
import { JobsService } from './jobs.service';

@Processor('job-dispatch-queue')
export class JobDispatchProcessor extends WorkerHost {
  private readonly logger = new Logger(JobDispatchProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly jobsService: JobsService,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const { sessionId, attempt } = job.data;
    
    if (attempt === 3) {
      return this.handleCancellation(sessionId);
    }

    this.logger.log(`🚀 Processing Dispatch Job: Session #${sessionId}, Attempt #${attempt}`);

    // 1. Kiểm tra trạng thái đơn hàng (phải là BROADCASTING)
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
      include: { user: true },
    });

    if (!session || session.status !== 'BROADCASTING') {
      this.logger.log(`⚠️ Session #${sessionId} is no longer BROADCASTING. Skipping.`);
      return;
    }

    // 2. Tìm thợ
    const customer = session.user;
    if (!customer.latitude || !customer.longitude) {
      this.logger.warn(`❌ Customer #${customer.id} has no lat/lng. Dispatching to all online technicians.`);
      await this.dispatchToAllOnline(session, attempt);
      return;
    }

    const radius = attempt === 1 ? 10 : 30; // 10km và 30km chuẩn thực tế Việt Nam
    const technicians = await this.findNearbyTechnicians(customer.latitude, customer.longitude, radius);

    if (technicians.length > 0) {
      this.logger.log(`✅ [Dispatch] Tìm thấy ${technicians.length} thợ trong bán kính ${radius}km.`);
      
      const isUrgent = session.isDangerous;
      const title = isUrgent ? '🆘 KHẨN CẤP: ĐƠN NGUY HIỂM!' : 'Có đơn sửa chữa mới! 🛠️';
      const body = `Khách hàng cần sửa ${session.deviceType || 'thiết bị'}.\nTriệu chứng: ${session.symptom || 'Cần kiểm tra'}.\nBấm để xem chi tiết!`;

      for (const tech of technicians) {
        if (tech.fcmToken) {
          try {
            await this.notificationsService.sendNotification({
              token: tech.fcmToken,
              title: title,
              body: body,
              channelId: 'job_alerts',
              data: {
                type: 'NEW_JOB',
                jobId: sessionId.toString(),
              },
            });
            this.logger.log(`🚀 [Dispatch] Đã gửi thông báo tới Thợ #${tech.id}`);
          } catch (err) {
            this.logger.error(`❌ [Dispatch] Lỗi gửi thông báo tới Thợ #${tech.id}: ${err.message}`);
          }
        } else {
          this.logger.warn(`⚠️ [Dispatch] Thợ #${tech.id} online nhưng không có FCM Token!`);
        }
      }
    } else {
      this.logger.log(`ℹ️ [Dispatch] Không tìm thấy thợ nào online trong bán kính ${radius}km quanh Khách hàng.`);
    }

    // 3. Xử lý bước tiếp theo
    if (attempt === 1) {
      await this.jobsService.addJobDispatch(sessionId, 2, 120000);
      this.logger.log(`⏱️ Scheduled Attempt 2 for Session #${sessionId} in 2 minutes.`);
    } else if (attempt === 2) {
      // Hẹn 8 phút nữa (tổng 10p) để check lần cuối và hủy nếu chưa ai nhận
      await this.jobsService.addJobDispatch(sessionId, 3, 480000);
      this.logger.log(`⏱️ Scheduled Final Check (Attempt 3) for Session #${sessionId} in 8 minutes.`);
    }
  }

  private async dispatchToAllOnline(session: any, attempt: number) {
    const onlineTechs = await this.prisma.user.findMany({
      where: { role: 'TECHNICIAN', isOnline: true, fcmToken: { not: null } },
    });

    for (const tech of onlineTechs) {
      await this.notificationsService.sendNotification({
        token: tech.fcmToken!,
        title: session.isDangerous ? '🆘 KHẨN CẤP: ĐƠN MỚI!' : 'Có đơn mới gần bạn! 🛠️',
        body: `Sửa ${session.deviceType || 'thiết bị'}: ${session.symptom || 'Cần kiểm tra'}.`,
        channelId: 'job_alerts',
        data: {
          type: 'NEW_JOB',
          jobId: session.id.toString(),
        },
      });
    }

    if (attempt === 1) {
      await this.jobsService.addJobDispatch(session.id, 2, 120000);
    } else if (attempt === 2) {
      await this.jobsService.addJobDispatch(session.id, 3, 480000);
    }
  }

  private async findNearbyTechnicians(lat: number, lng: number, radiusKm: number) {
    this.logger.log(`📍 [Dispatch] Đang quét thợ quanh vị trí Khách: Lat=${lat}, Lng=${lng} (Bán kính: ${radiusKm}km)`);

    // Sử dụng công thức Haversine chính xác hơn và xử lý lỗi làm tròn
    const technicians = await this.prisma.$queryRaw<any[]>`
      SELECT id, "fullName", "fcmToken", latitude, longitude,
        (6371 * acos(
          LEAST(1.0, 
            cos(radians(${lat})) * cos(radians(latitude)) * cos(radians(longitude) - radians(${lng})) + 
            sin(radians(${lat})) * sin(radians(latitude))
          )
        )) AS distance
      FROM users
      WHERE role = 'TECHNICIAN' 
        AND "isOnline" = true 
        AND latitude IS NOT NULL 
        AND longitude IS NOT NULL
      HAVING (6371 * acos(
          LEAST(1.0, 
            cos(radians(${lat})) * cos(radians(latitude)) * cos(radians(longitude) - radians(${lng})) + 
            sin(radians(${lat})) * sin(radians(latitude))
          )
        )) <= ${radiusKm}
      ORDER BY distance ASC
    `;

    return technicians;
  }

  private async handleCancellation(sessionId: number) {
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
      include: { user: true },
    });

    if (session && session.status === 'BROADCASTING') {
      await this.prisma.chatSession.update({
        where: { id: sessionId },
        data: { status: 'CANCELLED' },
      });

      if (session.user.fcmToken) {
        await this.notificationsService.sendTestNotification(
          session.user.fcmToken,
          'Rất tiếc! 😔',
          'Hiện tại các thợ đều đang bận. Đơn hàng của bạn đã bị hủy tự động sau 10 phút. Vui lòng thử lại sau nhé!',
        );
      }
      this.logger.log(`🚫 Session #${sessionId} automatically CANCELLED after timeout.`);
    }
  }
}
