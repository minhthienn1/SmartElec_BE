import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ChatsService } from './chats.service';
import { MessageType } from '@prisma/client';
import { Inject, forwardRef } from '@nestjs/common';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class ChatsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private messageRateLimit = new Map<
    number,
    { count: number; startTime: number }
  >();

  constructor(
    @Inject(forwardRef(() => ChatsService))
    private readonly chatsService: ChatsService,
    private readonly jwtService: JwtService,
  ) { }

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token as string;

      if (!token) {
        client.disconnect();
        return;
      }

      const payload = await this.jwtService.verifyAsync(token);

      const rawUserId = payload.sub || payload.userId || payload.id;
      const userId = Number(rawUserId);

      if (!userId || Number.isNaN(userId)) {
        client.disconnect();
        return;
      }

      client.data.userId = userId;
      client.data.role = payload.role;

      const userRoom = `user_${userId}`;
      client.join(userRoom);

      console.log(`⚡ [WS] User ${userId} authenticated & joined ${userRoom}`);
    } catch (error) {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const userId = client.data?.userId ?? 'unknown';
    console.log(`🔌 [WS] User ${userId} disconnected`);
  }

  @SubscribeMessage('join_room')
  async handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: number },
  ) {
    try {
      await this.chatsService.assertCanAccessSession(
        data.sessionId,
        client.data.userId,
        client.data.role,
      );

      const roomName = `room_${data.sessionId}`;
      client.join(roomName);

      console.log(`🚪 [WS] User ${client.data.userId} joined ${roomName}`);

      return {
        event: 'joined_room',
        data: {
          sessionId: data.sessionId,
        },
      };
    } catch (error: any) {
      client.emit('error_message', {
        message:
          error instanceof Error ? error.message : 'Không thể vào phòng chat.',
      });
    }
  }

  @SubscribeMessage('leave_room')
  handleLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: number },
  ) {
    const roomName = `room_${data.sessionId}`;
    client.leave(roomName);

    return {
      event: 'left_room',
      data: {
        sessionId: data.sessionId,
      },
    };
  }

  emitToRoom(sessionId: number, event: string, data: any) {
    this.server.to(`room_${sessionId}`).emit(event, data);
  }

  emitGlobal(event: string, data: any) {
    this.server.emit(event, data);
  }

  private checkMessageRateLimit(client: Socket, userId: number): boolean {
    const now = Date.now();

    const userLimit = this.messageRateLimit.get(userId) || {
      count: 0,
      startTime: now,
    };

    if (now - userLimit.startTime > 1000) {
      userLimit.count = 1;
      userLimit.startTime = now;
    } else {
      userLimit.count++;

      if (userLimit.count > 5) {
        client.emit('error_message', {
          message: 'Bạn nhắn tin quá nhanh. Vui lòng thử lại sau.',
        });

        return false;
      }
    }

    this.messageRateLimit.set(userId, userLimit);
    return true;
  }

  @SubscribeMessage('send_message')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      sessionId: number;
      content: string;
      type: string;
      metadata?: Record<string, any>;
    },
  ) {
    try {
      const userId = client.data.userId as number;

      if (!userId) {
        client.emit('error_message', {
          message: 'Bạn chưa đăng nhập hoặc phiên đăng nhập đã hết hạn.',
        });
        return;
      }

      const isAllowed = this.checkMessageRateLimit(client, userId);

      if (!isAllowed) {
        return;
      }

      const savedMessage = await this.chatsService.processSessionMessage(
        data.sessionId,
        userId,
        {
          type: data.type as MessageType,
          content: data.content,
          metadata: data.metadata,
        },
        client.data.role,
        client.id,
      );

      if (
        savedMessage &&
        typeof savedMessage === 'object' &&
        'deviceSwitchDetected' in savedMessage &&
        savedMessage.deviceSwitchDetected
      ) {
        client.emit('device_switch_detected', savedMessage);

        return {
          event: 'device_switch_detected',
          data: savedMessage,
        };
      }

      client.emit('message_delivered', {
        tempId: data.metadata?.tempId,
        savedMessage,
      });

      const session = await this.chatsService.getSessionById(data.sessionId);

      if (session) {
        const recipientId =
          userId === session.userId ? session.technicianId : session.userId;

        if (recipientId) {
          this.server.to(`user_${recipientId}`).emit('inbox_update', {
            sessionId: data.sessionId,
            lastMessage: savedMessage,
          });
        }
      }

      return {
        event: 'message_sent',
        data: savedMessage,
      };
    } catch (error: any) {
      console.warn(
        `⚠️ [WS Blocked] User ${client.data.userId}: ${error.message}`,
      );

      client.emit('error_message', {
        message: error.message || 'Không thể gửi tin nhắn.',
      });
    }
  }

  @SubscribeMessage('mark_as_read')
  async handleMarkAsRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: number; messageId: number },
  ) {
    try {
      const userId = client.data.userId as number;

      await this.chatsService.assertCanAccessSession(
        data.sessionId,
        userId,
        client.data.role,
      );

      const updatedMessage = await this.chatsService.markMessageAsReadForUser(
        data.messageId,
        userId,
        client.data.role,
      );

      this.server.to(`room_${data.sessionId}`).emit('message_read', {
        messageId: data.messageId,
        readBy: userId,
        readAt: new Date().toISOString(),
      });

      return {
        event: 'mark_as_read_success',
        data: updatedMessage,
      };
    } catch (error: any) {
      client.emit('error_message', {
        message: error.message || 'Không thể đánh dấu đã đọc.',
      });
    }
  }
}