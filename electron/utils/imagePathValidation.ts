import fs from 'node:fs';
import path from 'node:path';

/** Resolve before allowing: an app-prefixed symlink is not an app-owned file. */
export function validateImagePath(imagePath: string, userDataPath: string): { isValid: boolean; reason?: string; resolvedPath?: string } {
    if (typeof imagePath !== 'string' || !imagePath.trim() || imagePath.includes('\0')) return { isValid: false, reason: 'Image path must be a non-empty string' };
    if (imagePath.replace(/\\/g, '/').split('/').includes('..')) return { isValid: false, reason: 'Path traversal sequences are not allowed' };
    if (/^[A-Za-z]:[\\/]/.test(imagePath) || !path.isAbsolute(imagePath)) return { isValid: false, reason: 'Image path must be an absolute app-owned path' };
    try {
        const root = fs.realpathSync(userDataPath);
        const resolvedPath = fs.realpathSync(imagePath);
        const relative = path.relative(root, resolvedPath);
        if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return { isValid: false, reason: 'Image path resolves outside app directory' };
        if (!fs.statSync(resolvedPath).isFile()) return { isValid: false, reason: 'Image path must refer to a regular file' };
        if (!/\.(png|jpe?g)$/i.test(resolvedPath)) return { isValid: false, reason: 'Unsupported image file type' };
        return { isValid: true, resolvedPath };
    } catch { return { isValid: false, reason: 'Image file is missing or unreadable' }; }
}
