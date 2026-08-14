import { AiWebDeviceCatalogService } from './ai-web-device-catalog.service';

describe('AiWebDeviceCatalogService', () => {
  const service = new AiWebDeviceCatalogService();

  it('resolves supported aliases to one canonical device', () => {
    expect(service.resolve('máy lạnh')).toMatchObject({
      label: 'Điều hòa',
      category: 'COOLING_HEATING',
    });
    expect(service.resolve('điều hòa')).toMatchObject({ label: 'Điều hòa' });
  });

  it('rejects devices outside the web allowlist', () => {
    expect(service.resolve('máy bay')).toBeNull();
    expect(service.resolve('xe máy')).toBeNull();
    expect(service.resolve('máy quạt')).toBeNull();
  });

  it('counts canonical devices instead of duplicate aliases', () => {
    expect(service.countMentions('máy lạnh hay điều hòa đều không lạnh')).toBe(1);
    expect(service.countMentions('máy lạnh không lạnh, máy giặt không vắt')).toBe(2);
  });

  it('returns every supported device mentioned in natural text', () => {
    expect(
      service.collectMentions('Tủ lạnh yếu, còn lò vi sóng không nóng.'),
    ).toEqual([
      expect.objectContaining({ label: 'Tủ lạnh' }),
      expect.objectContaining({ label: 'Lò vi sóng' }),
    ]);
  });
});
