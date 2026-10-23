import { getModifierSymbol, isMac, isWindows } from './platformUtils';

/**
 * Converts an Electron Accelerator string to an array of platform-aware keys for the frontend.
 * Modifier symbols adapt to the current platform (e.g. ⌘ on macOS, Ctrl on Windows/Linux).
 */
export function acceleratorToKeys(accelerator: string): string[] {
    if (!accelerator) return [];

    const parts = accelerator.split('+');
    return parts.map(part => {
        switch (part.toLowerCase()) {
            case 'commandorcontrol':
            case 'cmd':
            case 'command':
            case 'meta':
                return getModifierSymbol('commandorcontrol');
            case 'control':
            case 'ctrl':
                // On macOS, explicit 'Ctrl' in an accelerator maps to the ⌃ key.
                // On Win/Linux, Ctrl IS CommandOrControl so show the same Ctrl label.
                return getModifierSymbol('ctrl');
            case 'alt':
            case 'option':
                return getModifierSymbol('alt');
            case 'shift':
                return getModifierSymbol('shift');
            case 'up':
            case 'arrowup':
                return '↑';
            case 'down':
            case 'arrowdown':
                return '↓';
            case 'left':
            case 'arrowleft':
                return '←';
            case 'right':
            case 'arrowright':
                return '→';
            default:
                // Capitalize first letter for consistency
                return part.length === 1 ? part.toUpperCase() : part;
        }
    });
}

export interface RecorderKeyEvent {
    key: string;
    code: string;
    metaKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
}

export type RecordedKeys =
    | { keys: string[]; complete: boolean }
    | { rejected: 'windows-key' };

/**
 * Maps one recorder keydown to the keys shown and saved. On Windows, metaKey is the
 * Windows key: Windows reserves those shortcuts, and '⌘' would otherwise be saved
 * as CommandOrControl (Ctrl), so such a recording is rejected instead.
 */
export function eventToKeys(e: RecorderKeyEvent, windows: boolean = isWindows): RecordedKeys {
    if (e.metaKey && windows) return { rejected: 'windows-key' };
    const { key, code } = e;

    // Ignore modifier key presses alone if possible, but we need to show them
    const modifiers = [];
    if (e.metaKey) modifiers.push('⌘');
    if (e.ctrlKey) modifiers.push('⌃');
    if (e.altKey) modifiers.push('⌥');
    if (e.shiftKey) modifiers.push('⇧');

    let mainKey = '';
    if (key !== 'Meta' && key !== 'Control' && key !== 'Alt' && key !== 'Shift') {
        if (code.startsWith('Key')) mainKey = key.toUpperCase();
        else if (code.startsWith('Digit')) mainKey = key;
        else if (code === 'Space') mainKey = 'Space';
        else if (key === 'Enter') mainKey = 'Enter';
        else if (key === 'Backspace') mainKey = 'Backspace';
        else if (key.startsWith('Arrow')) mainKey = key;
        else mainKey = key.toUpperCase();
    }

    return mainKey ? { keys: [...modifiers, mainKey], complete: true } : { keys: modifiers, complete: false };
}

/**
 * Converts an array of keys from the frontend to an Electron Accelerator string.
 * Example: ["Meta", "Shift", "Space"] -> "CommandOrControl+Shift+Space"
 */
export function keysToAccelerator(keys: string[]): string {
    const modifiers: string[] = [];
    let mainKey = '';

    keys.forEach(key => {
        switch (key.toLowerCase()) {
            case 'meta':
            case 'command':
            case 'cmd':
            case '⌘':
                modifiers.push('CommandOrControl');
                break;
            case 'control':
            case 'ctrl':
            case '⌃':
                // On non-Mac treating ⌃ (explicit Ctrl) as CommandOrControl keeps Electron happy.
                // If you need a Mac-only Ctrl binding, use 'Ctrl' directly in accelerator template.
                modifiers.push(isMac ? 'Control' : 'CommandOrControl');
                break;
            case 'alt':
            case 'option':
            case '⌥':
                modifiers.push('Alt');
                break;
            case 'shift':
            case '⇧':
                modifiers.push('Shift');
                break;
            case 'arrowup':
            case 'up':
            case '↑':
                mainKey = 'Up';
                break;
            case 'arrowdown':
            case 'down':
            case '↓':
                mainKey = 'Down';
                break;
            case 'arrowleft':
            case 'left':
            case '←':
                mainKey = 'Left';
                break;
            case 'arrowright':
            case 'right':
            case '→':
                mainKey = 'Right';
                break;
            default:
                mainKey = key.toUpperCase();
        }
    });

    // Electron expects modifiers first
    return [...modifiers, mainKey].filter(Boolean).join('+');
}
