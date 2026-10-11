import type { CredentialSaveResult } from './credentialSave';

export type DomesticSttProvider = 'aliyun' | 'doubao';
export interface DomesticSttSettings { key: string; workspaceId: string; appId: string }
export interface DomesticSttAPI {
  getDomesticStt(provider: DomesticSttProvider): Promise<{ hasKey: boolean; workspaceId: string; appId: string }>;
  saveDomesticStt(provider: DomesticSttProvider, input: DomesticSttSettings): Promise<CredentialSaveResult>;
  testDomesticStt(provider: DomesticSttProvider): Promise<{ success: boolean; error?: string }>;
}
