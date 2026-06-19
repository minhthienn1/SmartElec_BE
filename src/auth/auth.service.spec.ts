import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { MailService } from './mail.service';

describe('AuthService forgot-password flow', () => {
  let service: AuthService;

  const prisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  const jwtService = {
    signAsync: jest.fn(),
  };

  const otpStore = {
    save: jest.fn(),
    get: jest.fn(),
    delete: jest.fn(),
  };

  const mailService = {
    sendPasswordResetOtp: jest.fn(),
    sendEmailVerificationOtp: jest.fn(),
  };

  type UpdatePasswordCall = {
    where: { id: number };
    data: { password: string };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuthService(
      prisma as unknown as PrismaService,
      jwtService as unknown as JwtService,
      otpStore,
      mailService as unknown as MailService,
    );
  });

  it('stores and emails an OTP for an existing email', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 7,
      email: 'user@example.com',
    });

    await service.requestResetOtp({ email: 'user@example.com' });

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'user@example.com' },
    });
    expect(otpStore.save).toHaveBeenCalledWith(
      'user@example.com',
      expect.stringMatching(/^\d{6}$/),
      expect.any(Number),
    );
    expect(mailService.sendPasswordResetOtp).toHaveBeenCalledWith(
      'user@example.com',
      expect.stringMatching(/^\d{6}$/),
    );
  });

  it('rejects login when the account is locked', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 7,
      phoneNumber: '0123456789',
      password: await require('bcrypt').hash('secret123', 10),
      role: 'USER',
      needsPassword: false,
      isActive: false,
    });

    await expect(service.login('0123456789', 'secret123')).rejects.toMatchObject({
      message: 'Tài khoản đã bị khóa.',
    });
  });

  it('allows login when the account is active', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 7,
      phoneNumber: '0123456789',
      password: await require('bcrypt').hash('secret123', 10),
      role: 'USER',
      needsPassword: false,
      isActive: true,
    });
    jwtService.signAsync.mockResolvedValue('signed-token');
    prisma.user.update.mockResolvedValue({ id: 7 });

    const result = await service.login('0123456789', 'secret123');

    expect(result.access_token).toBe('signed-token');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { lastLogin: expect.any(Date) },
    });
  });

  it('throws when requesting an OTP for a missing email', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.requestResetOtp({ email: 'missing@example.com' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('verifies a valid OTP from the store', async () => {
    otpStore.get.mockResolvedValue({
      otp: '123456',
      expiresAt: new Date(Date.now() + 60_000),
    });

    const result = await service.verifyResetOtp({
      email: 'user@example.com',
      otp: '123456',
    });

    expect(result.verified).toBe(true);
    expect(result.message).toEqual(expect.any(String));
  });

  it('stores and emails an account-verification OTP for an unverified user', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 9,
      email: 'verify@example.com',
      isVerified: false,
    });

    await service.requestEmailVerificationOtp(9);

    expect(otpStore.save).toHaveBeenCalledWith(
      'email-verification:9:verify@example.com',
      expect.stringMatching(/^\d{6}$/),
      expect.any(Number),
    );
    expect(mailService.sendEmailVerificationOtp).toHaveBeenCalledWith(
      'verify@example.com',
      expect.stringMatching(/^\d{6}$/),
    );
  });

  it('marks the account as verified after a valid verification OTP', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 9,
      email: 'verify@example.com',
      isVerified: false,
    });
    otpStore.get.mockResolvedValue({
      otp: '123456',
      expiresAt: new Date(Date.now() + 60_000),
    });
    prisma.user.update.mockResolvedValue({ id: 9, isVerified: true });

    const result = await service.verifyEmailOtp(9, { otp: '123456' });

    expect(result.verified).toBe(true);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: { isVerified: true },
    });
    expect(otpStore.delete).toHaveBeenCalledWith(
      'email-verification:9:verify@example.com',
    );
  });

  it('rejects an invalid OTP', async () => {
    otpStore.get.mockResolvedValue({
      otp: '654321',
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(
      service.verifyResetOtp({ email: 'user@example.com', otp: '123456' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('resets the password and clears the OTP after successful verification', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 7,
      email: 'user@example.com',
    });
    otpStore.get.mockResolvedValue({
      otp: '123456',
      expiresAt: new Date(Date.now() + 60_000),
    });
    prisma.user.update.mockResolvedValue({ id: 7 });

    const result = await service.resetPassword({
      email: 'user@example.com',
      otp: '123456',
      newPassword: 'new-password',
    });

    expect(result.message).toEqual(expect.any(String));

    const updateCalls = prisma.user.update.mock.calls as [UpdatePasswordCall][];
    const updatePayload = updateCalls[0]?.[0];

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { password: updatePayload.data.password },
    });
    expect(updatePayload.data.password).toEqual(expect.any(String));
    expect(updatePayload.data.password).not.toBe('new-password');
    expect(otpStore.delete).toHaveBeenCalledWith('user@example.com');
  });
});
