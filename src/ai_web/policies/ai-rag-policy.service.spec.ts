import { AiRagPolicyService } from './ai-rag-policy.service';

describe('AiRagPolicyService', () => {
  const service = new AiRagPolicyService();

  it('blocks a generic symptom without strong diagnostic context', () => {
    expect(service.canUse({ symptom: 'bị hư', contextAnswers: {} })).toBe(false);
  });

  it('allows a specific symptom after collecting minimum context', () => {
    expect(service.canUse({
      symptom: 'không lạnh',
      contextAnswers: { operationStatus: 'dàn lạnh có gió' },
    })).toBe(true);
  });

  it('builds a query from device, symptom and collected context', () => {
    expect(service.buildQuery({
      device: 'Điều hòa',
      symptom: 'không lạnh',
      contextAnswers: { operationStatus: 'dàn lạnh có gió' },
    })).toBe('Điều hòa | không lạnh | dàn lạnh có gió');
  });
});
