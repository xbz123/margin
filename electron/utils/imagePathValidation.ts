import fs from 'node:fs';
import path from 'node:path';

type ImagePathResult = { isValid: boolean; reason?: string; resolvedPath?: string };

/** The platform rules and filesystem calls the check runs against; tests inject Windows. */
export interface ImagePathHost {
    platform: NodeJS.Platform;
    realpath(file: string): string;
    isFile(file: string): boolean;
}

// Both sides go through the same (non-native) realpath, so junctions and symlinks are
// resolved the same way for the app root and the image.
const HOST: ImagePathHost = {
    platform: process.platform,
    realpath: file => fs.realpathSync(file),
    isFile: file => fs.statSync(file).isFile(),
};

// Windows names that open a device instead of a file, with or without an extension
// (https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file).
const WINDOWS_DEVICE_NAME = /^(con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;

/**
 * Windows-only form checks before touching the filesystem. Drive paths and UNC paths
 * are left to the containment check below (a redirected AppData lives on a share);
 * the \\?\ and \\.\ namespaces, rooted paths without a drive, alternate data streams
 * and device names are refused outright.
 */
function windowsFormProblem(imagePath: string): string | undefined {
    const backslashed = imagePath.replace(/\//g, '\\');
    if (/^\\\\[?.]\\/.test(backslashed) || backslashed.startsWith('\\??\\')) return 'Device and namespace paths are not allowed';
    // "\x" is rooted on the current drive and "C:x" is relative to drive C's current folder.
    if ((backslashed.startsWith('\\') && !backslashed.startsWith('\\\\')) || /^[A-Za-z]:(?!\\)/.test(backslashed)) return 'Image path must be an absolute app-owned path';
    if (backslashed.indexOf(':', /^[A-Za-z]:\\/.test(backslashed) ? 2 : 0) !== -1) return 'Alternate data streams are not allowed';
    if (WINDOWS_DEVICE_NAME.test(path.win32.basename(backslashed))) return 'Device names are not allowed';
    return undefined;
}

/** Resolve before allowing: an app-prefixed symlink is not an app-owned file. */
export function validateImagePath(imagePath: string, userDataPath: string): ImagePathResult {
    return validateImagePathOn(HOST, imagePath, userDataPath);
}

export function validateImagePathOn(host: ImagePathHost, imagePath: string, userDataPath: string): ImagePathResult {
    if (typeof imagePath !== 'string' || !imagePath.trim() || imagePath.includes('\0')) return { isValid: false, reason: 'Image path must be a non-empty string' };
    if (imagePath.replace(/\\/g, '/').split('/').includes('..')) return { isValid: false, reason: 'Path traversal sequences are not allowed' };
    const windows = host.platform === 'win32';
    const rules = windows ? path.win32 : path.posix;
    if (windows) {
        const problem = windowsFormProblem(imagePath);
        if (problem) return { isValid: false, reason: problem };
        if (!rules.isAbsolute(imagePath)) return { isValid: false, reason: 'Image path must be an absolute app-owned path' };
    } else if (/^[A-Za-z]:[\\/]/.test(imagePath) || !rules.isAbsolute(imagePath)) return { isValid: false, reason: 'Image path must be an absolute app-owned path' };
    // path.win32.relative compares case-insensitively, as NTFS names do.
    const inside = (base: string, file: string) => {
        const relative = rules.relative(base, file);
        return !!relative && relative !== '..' && !relative.startsWith(`..${rules.sep}`) && !rules.isAbsolute(relative);
    };
    try {
        const root = host.realpath(userDataPath);
        // Windows: refuse a path outside the app folder before touching it, so a
        // foreign UNC path never opens a connection to another server.
        if (windows && !inside(rules.resolve(userDataPath), rules.resolve(imagePath)) && !inside(root, rules.resolve(imagePath))) return { isValid: false, reason: 'Image path resolves outside app directory' };
        const resolvedPath = host.realpath(imagePath);
        if (!inside(root, resolvedPath)) return { isValid: false, reason: 'Image path resolves outside app directory' };
        if (!host.isFile(resolvedPath)) return { isValid: false, reason: 'Image path must refer to a regular file' };
        if (!/\.(png|jpe?g)$/i.test(resolvedPath)) return { isValid: false, reason: 'Unsupported image file type' };
        return { isValid: true, resolvedPath };
    } catch { return { isValid: false, reason: 'Image file is missing or unreadable' }; }
}
