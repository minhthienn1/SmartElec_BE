import { Body, Controller, Get, NotFoundException, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminAccountsService } from './admin-accounts.service';
import { CreateAdminAccountDto } from './dto/create-admin-account.dto';
import { UpdateAdminAccountDto } from './dto/update-admin-account.dto';

@UseGuards(JwtAuthGuard)
@Controller('admin/accounts')
export class AdminAccountsController {
  constructor(private readonly adminAccountsService: AdminAccountsService) {}

  @Post()
  createAccount(@Body() payload: CreateAdminAccountDto) {
    return this.adminAccountsService.createAccount(payload);
  }

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

  @Patch(':id')
  async updateAccount(
    @Param('id', ParseIntPipe) accountId: number,
    @Body() payload: UpdateAdminAccountDto,
  ) {
    const account = await this.adminAccountsService.updateAccount(accountId, payload);

    if (!account) {
      throw new NotFoundException('Không tìm thấy tài khoản.');
    }

    return account;
  }
}
