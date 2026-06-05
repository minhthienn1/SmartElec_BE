import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminDispatchService } from './admin-dispatch.service';

@UseGuards(JwtAuthGuard)
@Controller('admin/dispatch')
export class AdminDispatchController {
  constructor(private readonly adminDispatchService: AdminDispatchService) {}

  /** Lấy snapshot điều phối riêng cho màn admin dispatch. */
  @Get()
  getDispatchData() {
    return this.adminDispatchService.getDispatchData();
  }

  /** Gán kỹ thuật viên cho một ca trong luồng dispatch. */
  @Post(':id/assign')
  async assign(
    @Param('id', ParseIntPipe) sessionId: number,
    @Body() body: { technicianId: number },
  ) {
    const session = await this.adminDispatchService.assign(
      sessionId,
      Number(body.technicianId),
    );

    if (!session) {
      throw new NotFoundException('Không tìm thấy ca điều phối.');
    }

    return session;
  }

  /** Gỡ kỹ thuật viên khỏi ca đang được điều phối. */
  @Post(':id/unassign')
  async unassign(@Param('id', ParseIntPipe) sessionId: number) {
    const session = await this.adminDispatchService.unassign(sessionId);

    if (!session) {
      throw new NotFoundException('Không tìm thấy ca điều phối.');
    }

    return session;
  }

  /** Đánh dấu kỹ thuật viên từ chối nhận ca điều phối hiện tại. */
  @Post(':id/reject')
  async reject(@Param('id', ParseIntPipe) sessionId: number) {
    const session = await this.adminDispatchService.reject(sessionId);

    if (!session) {
      throw new NotFoundException('Không tìm thấy ca điều phối.');
    }

    return session;
  }

  /** Mô phỏng timeout phản hồi của kỹ thuật viên trong quy trình dispatch. */
  @Post(':id/timeout')
  async timeout(@Param('id', ParseIntPipe) sessionId: number) {
    const session = await this.adminDispatchService.simulateTimeout(sessionId);

    if (!session) {
      throw new NotFoundException('Không tìm thấy ca điều phối.');
    }

    return session;
  }
}
