import { Controller, Get, NotFoundException, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminAccountsService } from './admin-accounts.service';

@UseGuards(JwtAuthGuard)
@Controller('admin/accounts')
export class AdminAccountsController {
  constructor(private readonly adminAccountsService: AdminAccountsService) {}

  @Get()
  getAccounts(
    @Query('keyword') keyword?: string,
    @Query('role') role?: string,
    @Query('status') status?: string,
    @Query('verified') verified?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.adminAccountsService.getAccounts({
      keyword,
      role,
      status,
      verified,
      page,
      pageSize,
    });
  }

  @Get(':id')
  async getAccountById(@Param('id', ParseIntPipe) accountId: number) {
    const account = await this.adminAccountsService.getAccountById(accountId);

    if (!account) {
      throw new NotFoundException('Không tìm thấy tài khoản.');
    }

    return account;
  }
}
