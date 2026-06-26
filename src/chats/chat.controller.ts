/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable prettier/prettier */
import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  Body,
  UseGuards,
  Req,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadService } from '../upload/upload.service';
import { ChatsService } from './chats.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MessageType } from '@prisma/client';
import { extname } from 'path';

@Controller('chat')
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(
    private readonly uploadService: UploadService,
    private readonly chatsService: ChatsService,
  ) {}

  private isSessionV2UploadRequest(
    req: { headers?: Record<string, unknown> },
    chatFlow?: string,
    enableDeviceSwitchCheck?: boolean | string,
  ): boolean {
    const headerValue = req.headers?.['x-chat-flow'];
    const normalizedHeader =
      typeof headerValue === 'string'
        ? headerValue
        : Array.isArray(headerValue)
          ? headerValue[0]
          : undefined;

    return (
      normalizedHeader === 'session-v2' ||
      chatFlow === 'session-v2' ||
      enableDeviceSwitchCheck === true ||
      enableDeviceSwitchCheck === 'true'
    );
  }

  @Post('upload')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  async uploadMedia(
    @UploadedFile() file: Express.Multer.File,
    @Body('sessionId') sessionId: string,
    @Body('deviceType') deviceType: string,
    @Body('chatFlow') chatFlow: string | undefined,
    @Body('enableDeviceSwitchCheck')
    enableDeviceSwitchCheck: boolean | string | undefined,
    @Req() req,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const userId = Number(req.user.id || req.user.userId || req.user.sub);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const role = req.user.role as string | undefined;
    const numericSessionId = Number(sessionId);
    const isSessionV2 = this.isSessionV2UploadRequest(
      req as { headers?: Record<string, unknown> },
      chatFlow,
      enableDeviceSwitchCheck,
    );

    if (isSessionV2) {
      const deviceSwitchResult =
        await this.chatsService.detectDeviceSwitchForSession(
          numericSessionId,
          userId,
          role,
          {
            deviceType,
            content: file?.originalname,
          },
        );
      if (deviceSwitchResult) {
        return deviceSwitchResult;
      }
    }

    await this.chatsService.assertCanAccessSession(
      numericSessionId,
      userId,
      role,
    );

    if (!file) {
      throw new BadRequestException('Không tìm thấy file upload.');
    }

    this.logger.log(
      `📁 Nhận file upload: ${file.originalname} | Mimetype: ${file.mimetype}`,
    );

    let finalMimetype = file.mimetype;
    if (finalMimetype === 'application/octet-stream') {
      const ext = extname(file.originalname).toLowerCase();
      const imageExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic'];
      const videoExts = ['.mp4', '.mov', '.mkv', '.avi'];

      if (imageExts.includes(ext))
        finalMimetype = 'image/' + (ext === '.jpg' ? 'jpeg' : ext.slice(1));
      if (videoExts.includes(ext))
        finalMimetype =
          'video/' + (ext === '.mov' ? 'quicktime' : ext.slice(1));

      this.logger.warn(
        `⚠️ Mimetype không xác định, sử dụng fallback từ extension: ${finalMimetype}`,
      );
    }

    const isImage = finalMimetype.startsWith('image/');
    const isVideo = finalMimetype.startsWith('video/');

    if (!isImage && !isVideo) {
      throw new BadRequestException(
        `Định dạng file không hỗ trợ (${finalMimetype}). Chỉ chấp nhận Ảnh hoặc Video.`,
      );
    }

    const maxSize = isImage ? 10 * 1024 * 1024 : 50 * 1024 * 1024;
    if (file.size > maxSize) {
      const limitLabel = isImage ? '10MB' : '50MB';
      throw new BadRequestException(
        `File quá lớn. Giới hạn cho ${isImage ? 'Ảnh' : 'Video'} là ${limitLabel}.`,
      );
    }

    file.mimetype = finalMimetype;

    const mediaUrl = await this.uploadService.uploadMediaToR2(file);
    const type = isVideo ? MessageType.VIDEO : MessageType.IMAGE;
    const mediaDto = {
      type: type,
      content: mediaUrl,
      deviceType: deviceType || undefined,
      metadata: {
        fileName: file.originalname,
        fileSize: file.size,
        mimeType: file.mimetype,
      },
    };

    const message = isSessionV2
      ? await this.chatsService.processSessionMessage(
          numericSessionId,
          userId,
          mediaDto,
          role,
        )
      : await this.chatsService.sendMessage(
          numericSessionId,
          userId,
          mediaDto,
        );

    return {
      success: true,
      url: mediaUrl,
      type: type,
      data: message,
    };
  }
}
