import { AiQuestionPolicyService } from './ai-question-policy.service';

describe('AiQuestionPolicyService', () => {
  const service = new AiQuestionPolicyService();

  it('selects the specialized air-conditioner question set', () => {
    expect(
      service.buildQuestionSet('Điều hòa', 'COOLING_HEATING', 'không mát'),
    ).toBe('COOLING_HEATING::AIR_CONDITIONER_NOT_COOL');
  });

  it('renders exactly three deterministic context questions', () => {
    const message = service.buildQuestionSetMessage('WATER_APPLIANCE::GENERIC');
    expect(message).toContain('1.');
    expect(message).toContain('2.');
    expect(message).toContain('3.');
  });

  it('falls back to the generic template for an unknown set', () => {
    expect(service.getTemplate('UNKNOWN').questions).toHaveLength(3);
  });
});
