import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminAccountsService } from './admin-accounts.service';
import { CreateAdminAccountDto } from './dto/create-admin-account.dto';
import { UpdateAdminAccountDto } from './dto/update-admin-account.dto';

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
      throw new NotFoundException('Khong tim thay tai khoan.');
    }

    return account;
  }

  @Post()
  createAccount(@Body() payload: CreateAdminAccountDto) {
    return this.adminAccountsService.createAccount(payload);
  }

  @Patch(':id')
  async updateAccount(
    @Param('id', ParseIntPipe) accountId: number,
    @Body() payload: UpdateAdminAccountDto,
  ) {
    const account = await this.adminAccountsService.updateAccount(
      accountId,
      payload,
    );

    if (!account) {
      throw new NotFoundException('Khong tim thay tai khoan.');
    }

    return account;
  }

  @Post(':id/lock')
  lockAccount(@Param('id', ParseIntPipe) accountId: number) {
    return this.adminAccountsService.lockAccount(accountId);
  }

  @Post(':id/unlock')
  unlockAccount(@Param('id', ParseIntPipe) accountId: number) {
    return this.adminAccountsService.unlockAccount(accountId);
  }

  @Post(':id/verify')
  verifyAccount(@Param('id', ParseIntPipe) accountId: number) {
    return this.adminAccountsService.verifyAccount(accountId);
  }

  @Post(':id/unverify')
  unverifyAccount(@Param('id', ParseIntPipe) accountId: number) {
    return this.adminAccountsService.unverifyAccount(accountId);
  }

  @Post(':id/role')
  changeAccountRole(
    @Param('id', ParseIntPipe) accountId: number,
    @Body() body: { role: UserRole },
  ) {
    return this.adminAccountsService.changeAccountRole(accountId, body.role);
  }

  @Post(':id/reset-password')
  resetAccountPassword(
    @Param('id', ParseIntPipe) accountId: number,
    @Body() body: { password: string },
  ) {
    return this.adminAccountsService.resetAccountPassword(
      accountId,
      body.password,
    );
  }

  @Delete(':id')
  deleteAccount(@Param('id', ParseIntPipe) accountId: number) {
    return this.adminAccountsService.deleteAccount(accountId);
  }
}
