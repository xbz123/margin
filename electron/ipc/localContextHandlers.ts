import { app, BrowserWindow, dialog } from 'electron';
import * as path from 'node:path';
import { LocalContextStore, LocalContextError } from '../services/LocalContextStore';
import type { LocalContextResult } from '../../src/types/localContext';

export function registerLocalContextHandlers(handle: (channel: string, callback: (event: any, ...args: any[]) => Promise<LocalContextResult>) => void,
    changed: () => void) {
    const store = () => new LocalContextStore(path.join(app.getPath('userData'), 'local-context.json'));
    const operation = (action: (event: any, value: unknown) => unknown) => async (event: any, value?: unknown): Promise<LocalContextResult> => {
        try {
            if (!BrowserWindow.fromWebContents(event.sender)) throw new LocalContextError('The settings window is unavailable.');
            await action(event, value);
            return { ok: true, entries: store().list() };
        } catch (error) {
            return { ok: false, error: error instanceof LocalContextError ? error.message : 'Local Context could not be saved. The previous contents were kept.' };
        }
    };
    handle('local-context:list', operation(() => {}));
    handle('local-context:add', operation(async event => {
        const selected = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender)!, {
            properties: ['openFile', 'multiSelections'], filters: [{ name: 'Markdown / Text', extensions: ['md', 'markdown', 'txt'] }],
        }) as unknown as Electron.OpenDialogReturnValue;
        if (!selected.canceled) { store().addFiles(selected.filePaths); changed(); }
    }));
    handle('local-context:remove', operation((_event, id) => {
        if (typeof id !== 'string') throw new LocalContextError('Invalid Local Context entry.');
        store().remove(id);
        changed();
    }));
}
