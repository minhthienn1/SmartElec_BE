import { AiIntentGateService } from './ai-intent-gate.service';

describe('AiIntentGateService alias boundary', () => {
  const service = new AiIntentGateService();

  it('thiet bi ngoai alias noi bo phai tra ve unsupported ro rang', () => {
    const result = service.analyze('may quat bi hu');
    const normalizedLabel = service.normalizeIntentText(result.detectedDeviceLabel ?? '');
    const normalizedResponse = service.normalizeIntentText(result.directResponse ?? '');

    expect(normalizedLabel).toBe('may quat');
    expect(result.supportedDeviceCategory).toBe('UNKNOWN');
    expect(result.outOfScopeDeviceCategory).toBeNull();
    expect(result.intent).toBe('OUT_OF_SCOPE_TECHNICAL');
    expect(result.shouldReturnDirectResponse).toBe(true);
    expect(normalizedResponse).toContain('chua ho tro');
  });

  it('chi nhan dien laptop la nhom out-of-scope da duoc dinh nghia ro', () => {
    const result = service.analyze('laptop bi liet phim');

    expect(result.detectedDeviceLabel).toBe('Laptop');
    expect(result.outOfScopeDeviceCategory).toBe('LAPTOP');
    expect(result.intent).toBe('OUT_OF_SCOPE_TECHNICAL');
  });

  it('xe may thi sao van phai tra ve unsupported thay vi hoi nguoc lai', () => {
    const result = service.analyze('xe may thi sao');
    const normalizedLabel = service.normalizeIntentText(result.detectedDeviceLabel ?? '');
    const normalizedResponse = service.normalizeIntentText(result.directResponse ?? '');

    expect(normalizedLabel).toBe('xe may');
    expect(result.supportedDeviceCategory).toBe('UNKNOWN');
    expect(result.intent).toBe('OUT_OF_SCOPE_TECHNICAL');
    expect(result.shouldReturnDirectResponse).toBe(true);
    expect(normalizedResponse).toContain('chua ho tro');
  });

  it('xe dap co sua ko van phai tra ve unsupported thay vi hoi chung chung', () => {
    const result = service.analyze('xe dap co sua ko');
    const normalizedLabel = service.normalizeIntentText(result.detectedDeviceLabel ?? '');
    const normalizedResponse = service.normalizeIntentText(result.directResponse ?? '');

    expect(normalizedLabel).toBe('xe dap');
    expect(result.supportedDeviceCategory).toBe('UNKNOWN');
    expect(result.intent).toBe('OUT_OF_SCOPE_TECHNICAL');
    expect(result.shouldReturnDirectResponse).toBe(true);
    expect(normalizedResponse).toContain('chua ho tro');
  });

  it('tra loi truc tiep khi user hoi ben minh sua chua thiet bi gi', () => {
    const result = service.analyze('ben ban sua chua thiet bi gi vay');
    const normalizedResponse = service.normalizeIntentText(result.directResponse ?? '');

    expect(result.intent).toBe('NORMAL');
    expect(result.shouldReturnDirectResponse).toBe(true);
    expect(normalizedResponse).toContain('may lanh');
    expect(normalizedResponse).toContain('may giat');
  });
});
