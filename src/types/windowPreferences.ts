export type DisguiseMode = 'terminal' | 'settings' | 'activity' | 'none';
export type WindowPreferenceKind = 'protection' | 'passthrough' | 'disguise';
export type WindowPreferenceResult = {
    success: boolean;
    kind: WindowPreferenceKind;
    value: boolean | DisguiseMode;
    revision: number;
    pending?: boolean;
    code?: 'invalid_value' | 'save_failed' | 'apply_failed' | 'superseded';
    error?: string;
};
export type KeybindResult = {
    success: boolean;
    keybinds: Array<{ id: string; label: string; accelerator: string; isGlobal: boolean; defaultAccelerator: string }>;
    failedActions: Array<{ id: string; accelerator: string }>;
    code?: 'invalid_value' | 'save_failed' | 'apply_failed';
    error?: string;
};

export const isDisguiseMode = (value: unknown): value is DisguiseMode =>
    value === 'none' || value === 'terminal' || value === 'settings' || value === 'activity';
