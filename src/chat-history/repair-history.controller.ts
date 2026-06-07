import { Controller, Get, Req, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RepairHistoryService } from './repair-history.service';

@Controller('repairs')
@UseGuards(AuthGuard('jwt'))
export class RepairHistoryController {
  constructor(private readonly repairHistoryService: RepairHistoryService) {}

  @Get('history')
  @HttpCode(HttpStatus.OK)
  async getRepairHistory(@Req() req: { user: { userId: number } }) {
    console.log('--- [API HITTING] GET /repairs/history ---');
    const userId = req.user.userId;
    return this.repairHistoryService.getRepairHistory(userId);
  }
}