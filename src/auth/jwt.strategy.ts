/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // Thêm '!' ở cuối hoặc dùng dấu '||' để ép kiểu string
      secretOrKey: process.env.JWT_SECRET || 'SmartElec_Thaibao1806',
    });
  }

  async validate(payload: any) {
    return {
      userId: payload.sub,
      phone: payload.phone,
      role: payload.role,
    };
  }
}
