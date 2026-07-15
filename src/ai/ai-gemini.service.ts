import { Injectable, Logger } from '@nestjs/common';
import {
    GenerativeModel,
    GoogleGenerativeAI,
} from '@google/generative-ai';
import { ConfigService } from '@nestjs/config';

import {
    responseSchema,
    smartElecSystemPrompt,
} from './ai.constants';

@Injectable()
export class AiGeminiService {
    private readonly logger = new Logger(AiGeminiService.name);
    private readonly genAI: GoogleGenerativeAI;
    private readonly model: GenerativeModel;

    constructor(private readonly configService: ConfigService) {
        const apiKey = this.configService.get<string>('GEMINI_API_KEY') || '';

        this.genAI = new GoogleGenerativeAI(apiKey);

        this.model = this.genAI.getGenerativeModel({
            model: 'gemini-2.5-flash',
            systemInstruction: smartElecSystemPrompt,
            generationConfig: {
                temperature: 0.1,
                topP: 0.8,
                topK: 40,
                responseMimeType: 'application/json',
                responseSchema,
            },
        });
    }

    async generateRawResponse(input: {
        userPrompt: string;
        history?: any[];
        imageBase64?: string;
    }): Promise<string> {
        const parts: any[] = [{ text: input.userPrompt }];

        if (input.imageBase64) {
            parts.push({
                inlineData: {
                    mimeType: 'image/jpeg',
                    data: input.imageBase64,
                },
            });
        }

        const chat = this.model.startChat({
            history: input.history || [],
        });

        const result = await chat.sendMessage(parts);
        const response = result.response;

        return response.text();
    }
}