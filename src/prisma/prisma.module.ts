import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global() // Giúp PrismaService có mặt ở mọi nơi trong App
@Module({
  providers: [PrismaService],
  exports: [PrismaService], // Phải export thì các module khác mới dùng được
})
export class PrismaModule {}
