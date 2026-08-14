import { AiContextCollectorService } from './ai-context-collector.service';
import { AiSafetyPolicyService } from '../policies/ai-safety-policy.service';

describe('AiContextCollectorService', () => {
  const service = new AiContextCollectorService(new AiSafetyPolicyService());

  it('extracts operation status and safety signs from natural text', () => {
    expect(
      service.extract('Đèn vẫn sáng, đĩa vẫn quay nhưng có mùi khét.'),
    ).toMatchObject({
      operationStatus: 'đèn vẫn sáng, đĩa vẫn quay',
      safetySigns: 'Có mùi khét',
    });
  });

  it('keeps previous answers when next values are empty', () => {
    expect(
      service.merge(
        { operationStatus: 'còn lên nguồn', errorCode: 'E5' },
        { operationStatus: null, abnormalSigns: 'kêu to' },
      ),
    ).toEqual({
      operationStatus: 'còn lên nguồn',
      errorCode: 'E5',
      abnormalSigns: 'kêu to',
    });
  });

  it('selects only the most important missing follow-up', () => {
    expect(
      service.pickFollowupKey('COOLING_HEATING::AIR_CONDITIONER_NOT_COOL', {
        operationStatus: 'dàn lạnh có gió',
      }),
    ).toBe('outdoorUnitStatus');
  });
});
