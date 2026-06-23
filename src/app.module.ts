import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bullmq';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { PrismaModule } from './prisma/prisma.module';
import { ChatHistoryModule } from './chat-history/chat-history.module';
import { DevicesModule } from './devices/devices.module';
import { ChatsModule } from './chats/chats.module';
import { UploadModule } from './upload/upload.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AiModule } from './ai/ai.module';
import { MechanicAiModule } from './mechanic-ai/mechanic-ai.module';
import { JobsModule } from './jobs/jobs.module';
import { AdminModule } from './admin/admin.module';
import { RagModule } from './rag/rag.module';
import { TechnicianModule } from './technician/technician.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('REDIS_URL');
        return {
          connection: {
            url: url,
            tls: url?.startsWith('rediss://') ? {} : undefined,
          },
        };
      },
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{
      name: 'ai_chat',
      ttl: 3000, 
      limit: 1,  
    }, {
      name: 'normal_chat',
      ttl: 1000,
      limit: 5,
    }]),
    AuthModule, 
    UsersModule, 
    PrismaModule, 
    ChatHistoryModule, 
    DevicesModule,
    ChatsModule,
    UploadModule,
    NotificationsModule,
    AiModule,
    MechanicAiModule,
    RagModule,
    JobsModule,
    AdminModule,
    TechnicianModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

