import { Controller, Get, Post, Body, Param, Delete, Patch, UseGuards, Req, HttpCode, HttpStatus, ParseIntPipe } from '@nestjs/common';
import { DevicesService } from './devices.service';
import { CreateDeviceDto } from './dto/create-device.dto';
import { AuthGuard } from '@nestjs/passport';

@Controller('devices')
@UseGuards(AuthGuard('jwt'))
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Req() req: { user: { userId: number } },
    @Body() createDeviceDto: CreateDeviceDto,
  ) {
    return this.devicesService.createDevice(req.user.userId, createDeviceDto);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  findAll(@Req() req: { user: { userId: number } }) {
    return this.devicesService.getUserDevices(req.user.userId);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  findOne(
    @Req() req: { user: { userId: number } },
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.devicesService.getDeviceById(id, req.user.userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(
    @Req() req: { user: { userId: number } },
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.devicesService.deleteDevice(id, req.user.userId);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  update(
    @Req() req: { user: { userId: number } },
    @Param('id', ParseIntPipe) id: number,
    @Body() updateDto: any,
  ) {
    return this.devicesService.updateDevice(id, req.user.userId, updateDto);
  }
}
