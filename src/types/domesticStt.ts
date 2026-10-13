export type DomesticSttProvider = 'aliyun' | 'doubao';
// Doubao billing resource the user bought: hourly or concurrent. Never inferred from the key.
export type DoubaoResourceId = 'volc.seedasr.sauc.duration' | 'volc.seedasr.sauc.concurrent';
export interface DomesticSttSettings { key: string; workspaceId: string; appId: string; resourceId?: DoubaoResourceId }
export interface DomesticSttPublicConfig { hasKey: boolean; workspaceId: string; appId: string; resourceId: DoubaoResourceId }
