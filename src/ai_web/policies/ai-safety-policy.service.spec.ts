import { AiSafetyPolicyService } from './ai-safety-policy.service';

describe('AiSafetyPolicyService', () => {
  const service = new AiSafetyPolicyService();

  it('detects explicit electrical safety signs', () => {
    expect(service.detectSigns('Thiết bị có mùi khét và tia lửa')).toEqual([
      'Có mùi khét',
      'Có tia lửa',
    ]);
  });

  it('builds a warning for safety signs or high risk', () => {
    expect(service.buildWarning('Có mùi khét', 'GREEN')).toContain('ngắt nguồn');
    expect(service.buildWarning(null, 'RED')).toContain('ngắt nguồn');
    expect(service.buildWarning(null, 'GREEN')).toBeNull();
  });

  it('prepends the warning before diagnostic content', () => {
    expect(service.prepend('Nội dung tư vấn', 'Cảnh báo')).toBe(
      'Cảnh báo\n\nNội dung tư vấn',
    );
  });
});
