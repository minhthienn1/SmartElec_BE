import { AiResponseBuilderService } from './ai-response-builder.service';

describe('AiResponseBuilderService', () => {
  it('does not put an unsupported device into a new conversation state', () => {
    const service = new AiResponseBuilderService();

    const result = service.buildDirectParsedResponse(
      {
        intent: 'OUT_OF_SCOPE_TECHNICAL',
        directResponse: 'Thiết bị này chưa được hỗ trợ.',
        detectedDeviceLabel: 'Máy Bay',
        detectedIssueLabel: 'Muốn sửa máy bay',
        supportedDeviceCategory: 'UNKNOWN',
      },
      null,
    );

    expect(result.state.device).toBeNull();
    expect(result.state.symptom).toBeNull();
  });
});
