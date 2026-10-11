import { loadNativeModule } from './nativeModuleLoader';

export interface AudioDevice {
    id: string;
    name: string;
}

export class AudioDevices {
    public static getInputDevices(): AudioDevice[] {
        return this.enumerate('input');
    }

    public static getOutputDevices(): AudioDevice[] {
        return this.enumerate('output');
    }

    private static enumerate(kind: 'input' | 'output'): AudioDevice[] {
        try {
            const native = loadNativeModule();
            if (!native) return [];
            const raw: unknown = kind === 'input' ? native.getInputDevices() : native.getOutputDevices();
            if (!Array.isArray(raw)) throw new Error('Native device enumeration did not return an array');
            const devices = new Map<string, AudioDevice>();
            for (const value of raw) {
                if (!value || typeof value.id !== 'string' || typeof value.name !== 'string') continue;
                const { id, name } = value;
                if (!id.trim() || !name.trim()) continue;
                // The capture backend's private aggregate must never be selected as a source.
                if (/nativelysystemaudiotap/i.test(id + '\n' + name)) continue;
                devices.set(id, { id, name });
            }
            return Array.from(devices.values());
        } catch (error) {
            console.error('[AudioDevices] Enumeration failed:', error);
            return [];
        }
    }
}
