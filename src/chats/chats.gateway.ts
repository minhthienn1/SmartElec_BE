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

  constructor(
    @Inject(forwardRef(() => ChatsService))
    private readonly chatsService: ChatsService,
    private readonly jwtService: JwtService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token as string;
      if (!token) {
        client.disconnect();
        return;
      }
      const payload = await this.jwtService.verifyAsync(token);
      client.data.userId = payload.sub;
      const userRoom = `user_${payload.sub}`;
      client.join(userRoom);
      console.log(`⚡ [WS] User ${payload.sub} authenticated & joined ${userRoom}`);
    } catch (error) {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const userId = client.data?.userId ?? 'unknown';
    console.log(`🔌 [WS] User ${userId} disconnected`);
  }

  @SubscribeMessage('join_room')
  handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: number },
  ) {
    const roomName = `room_${data.sessionId}`;
    client.join(roomName);
    console.log(`🚪 [WS] User ${client.data.userId} joined ${roomName}`);
    return { event: 'joined_room', data: { sessionId: data.sessionId } };
  }

  @SubscribeMessage('leave_room')
  handleLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: number },
  ) {
    const roomName = `room_${data.sessionId}`;
    client.leave(roomName);
    return { event: 'left_room', data: { sessionId: data.sessionId } };
  }

  emitToRoom(sessionId: number, event: string, data: any) {
    this.server.to(`room_${sessionId}`).emit(event, data);
  }

  emitGlobal(event: string, data: any) {
    this.server.emit(event, data);
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
      const roomName = `room_${data.sessionId}`;

      // ✅ PRODUCTION FIX: Gửi tin nhắn đã lưu db ngay cho người gửi
      // Người gửi ngay lập tức nhận được message đã có ID thật từ DB
      const savedMessage = await this.chatsService.sendMessage(
        data.sessionId,
        userId,
        {
          type: data.type as MessageType,
          content: data.content,
          metadata: data.metadata,
        },
        client.id, // ← ChatsService sẽ dùng client.id để loại trừ người gửi khi emit broadcast
      );

      // Trả về confirmation cho client
      client.emit('message_delivered', {
        tempId: data.metadata?.tempId, // Frontend gửi kèm ID tạm để match
        savedMessage: savedMessage,
      });

      // Cập nhật inbox cho đối phương
      const session = await this.chatsService.getSessionById(data.sessionId);
      if (session) {
        const recipientId = userId === session.userId ? session.technicianId : session.userId;
        if (recipientId) {
          this.server.to(`user_${recipientId}`).emit('inbox_update', {
            sessionId: data.sessionId,
            lastMessage: savedMessage,
          });
        }
      }

      return { event: 'message_sent', data: savedMessage };
    } catch (error) {
      console.error('❌ Lỗi gửi tin nhắn:', error.message);
      client.emit('error_message', { message: error.message });
    }
  }

  @SubscribeMessage('mark_as_read')
  async handleMarkAsRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: number; messageId: number },
  ) {
    try {
      const userId = client.data.userId as number;
      const updatedMessage = await this.chatsService.markAsRead(data.messageId);
      this.server.to(`room_${data.sessionId}`).emit('message_read', {
        messageId: data.messageId,
        readBy: userId,
        readAt: new Date().toISOString(),
      });
      return { event: 'mark_as_read_success', data: updatedMessage };
    } catch (error) {
      client.emit('error_message', { message: error.message });
    }
  }
}
