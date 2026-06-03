import { Module } from '@nestjs/common';
import { AdminAccountsModule } from './accounts/admin-accounts.module';
import { AdminTechniciansModule } from './technicians/admin-technicians.module';

@Module({
  imports: [AdminAccountsModule, AdminTechniciansModule],
})
export class AdminModule {}
