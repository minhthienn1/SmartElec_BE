import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateChatSessionDto } from '../chats/dto/create-chat-session.dto';
import { ChatsWebService } from './chats-web.service';

@Controller('chats-web')
export class ChatsWebController {
  constructor(private readonly chatsWebService: ChatsWebService) {}

  @Post('sessions')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async createChatSession(@Req() req, @Body() dto: CreateChatSessionDto) {
    const { userId } = getRequestUser(req);
    return this.chatsWebService.createChatSession(userId, dto);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async getSessionById(@Param('id', ParseIntPipe) id: number, @Req() req) {
    const { userId, role } = getRequestUser(req);
    return this.chatsWebService.getSessionByIdForUser(id, userId, role);
  }

  @Get(':id/messages')
  @UseGuards(JwtAuthGuard)
  async getMessages(
    @Param('id', ParseIntPipe) sessionId: number,
    @Req() req,
    @Query('cursor') cursorRaw?: string,
    @Query('limit') limitRaw?: string,
  ) {
    const { userId, role } = getRequestUser(req);
    const cursor = cursorRaw ? parseInt(cursorRaw, 10) : undefined;
    const limit = limitRaw ? parseInt(limitRaw, 10) : 20;

    return this.chatsWebService.getMessagesForUser(
      sessionId,
      userId,
      role,
      cursor,
      limit,
    );
  }

  @Post(':id/book')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async bookTechnician(
    @Param('id', ParseIntPipe) sessionId: number,
    @Req() req,
    @Body() body: {
      contactName?: string;
      contactPhone?: string;
      address?: string;
      latitude?: number;
      longitude?: number;
    },
  ) {
    const { userId, role } = getRequestUser(req);
    const session = await this.chatsWebService.bookTechnicianFromSession(
      sessionId,
      userId,
      role,
      body,
    );

    return {
      message: 'Đã chuyển phiên AI sang trạng thái gọi thợ thành công.',
      data: session,
    };
  }
  @Post(':id/image')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file'))
  async uploadMediaMessage(
    @Param('id', ParseIntPipe) sessionId: number,
    @UploadedFile() file: Express.Multer.File,
    @Body('deviceType') deviceType: string,
    @Body('symptom') symptom: string,
    @Req() req,
  ) {
    const { userId, role } = getRequestUser(req);

    if (!file) {
      throw new BadRequestException('KhÃ´ng tÃ¬m tháº¥y file. Vui lÃ²ng chá»n file Ä‘á»ƒ gá»­i.');
    }

    const result = await this.chatsWebService.uploadMediaMessage(
      sessionId,
      userId,
      role,
      file,
      deviceType,
      symptom,
    );

    if ('deviceSwitchDetected' in result) {
      return result;
    }

    return {
      message: 'Gá»­i file thÃ nh cÃ´ng!',
      fileUrl: result.content,
      data: result,
    };
  }
}

function getRequestUser(req: any): { userId: number; role?: string } {
  return {
    userId: Number(req.user?.id || req.user?.userId || req.user?.sub),
    role:
      typeof req.user?.role === 'string'
        ? req.user.role
        : typeof req.user?.userType === 'string'
          ? req.user.userType
          : undefined,
  };
}
