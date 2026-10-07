import { TrustLevel, ContextBlock } from './TrustLevels';

 export interface ContextPacket {
     blocks: ContextBlock[];
     systemPrompt: string;
     developerPrompt?: string; // For any developer-role instructions
     userMessage: string;
     metadata: {
         screenContextAvailable: boolean;
         tokenBudget: number;
         totalTokensUsed: number;
     };
 }