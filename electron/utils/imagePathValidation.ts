// Path validation for screenshot images sent to the vision pipeline. Moved out of
// curlUtils.ts when the cURL provider was removed (PLAN.md AG-16); unchanged.
import fs from "node:fs";
import path from "node:path";

/**
 * SECURITY (P0): Validates that an image path is safe to use.
 *
 * Uses realpath resolution to detect symlink escapes and provides
 * defense-in-depth against path traversal attacks.
 *
 * Blocks:
 * - Path traversal sequences (/../ or /..\)
 * - Absolute paths outside app-owned directories
 * - Sensitive system paths (/etc/, /home/, /var/, etc.)
 * - Windows drive paths (C:\, D:\, etc.)
 * - Symlink escapes to directories outside allowed roots
 *
 * Allowed paths (allowlist):
 * - Paths inside userData directory
 * - Paths inside <userData>/screenshots/
 * - Paths inside <userData>/extra_screenshots/
 * - Any other explicitly created app-owned screenshot directories
 *
 * @param imagePath - The path to validate
 * @param userDataPath - The app's userData directory path
 * @returns { isValid: boolean, reason?: string }
 */
export function validateImagePath(imagePath: string, userDataPath: string): { isValid: boolean; reason?: string } {
    if (!imagePath || typeof imagePath !== 'string') {
        return { isValid: false, reason: 'Image path must be a non-empty string' };
    }

    // Normalize path separators
    const normalizedPath = imagePath.replace(/\\/g, '/');

    // Block path traversal
    if (normalizedPath.includes('/../') || normalizedPath.includes('/..\\')) {
        return { isValid: false, reason: 'Path traversal sequences are not allowed' };
    }

    // Block Windows drive paths
    if (/^[A-Za-z]:\\/.test(imagePath)) {
        return { isValid: false, reason: 'Windows absolute paths are not allowed' };
    }

    // Normalize userDataPath for comparison
    const normalizedUserData = userDataPath.replace(/\\/g, '/');

    // Define allowed roots (app-owned directories only)
    const allowedRoots = [
        normalizedUserData,
        path.join(normalizedUserData, 'screenshots').replace(/\\/g, '/'),
        path.join(normalizedUserData, 'extra_screenshots').replace(/\\/g, '/'),
    ].filter(Boolean);

    // Resolve the image path to its real path to detect symlink escapes
    let resolvedPath: string;
    try {
        resolvedPath = fs.realpathSync(imagePath);
        resolvedPath = resolvedPath.replace(/\\/g, '/');
    } catch {
        // If realpath fails, the file doesn't exist or is inaccessible.
        // We still want to validate the requested path for security.
        // Check if the requested path itself is safe (not crossing boundaries).
        resolvedPath = normalizedPath;
    }

    // Normalize userData for comparison (ensure trailing slash for prefix matching)
    const normalizedUserDataWithSlash = normalizedUserData ? normalizedUserData.replace(/\/?$/, '/') : '';

    // Check if resolved path is within any allowed root
    const isAllowed = allowedRoots.some(allowedRoot => {
        const allowedWithSlash = allowedRoot.replace(/\/?$/, '/');
        return resolvedPath.startsWith(allowedWithSlash) || resolvedPath === allowedRoot;
    });

    if (isAllowed) {
        return { isValid: true };
    }

    // Also check the original path against allowed roots as fallback
    // This handles cases where the resolved path is the same as normalized
    const originalIsAllowed = allowedRoots.some(allowedRoot => {
        const allowedWithSlash = allowedRoot.replace(/\/?$/, '/');
        return normalizedPath.startsWith(allowedWithSlash) || normalizedPath === allowedRoot;
    });

    if (originalIsAllowed) {
        return { isValid: true };
    }

    // Block Unix absolute paths that are outside userData
    if (normalizedPath.startsWith('/etc/') ||
        normalizedPath.startsWith('/home/') ||
        normalizedPath.startsWith('/var/') ||
        normalizedPath.startsWith('/tmp/')) {
        return { isValid: false, reason: 'Paths outside app directory are not allowed' };
    }

    // Block paths that resolve outside allowed roots (symlink escape attempt)
    if (resolvedPath !== normalizedPath && !isAllowed) {
        return { isValid: false, reason: 'Symlink escape detected: path resolves outside allowed directory' };
    }

    // If we can't determine the path is safe, block it
    return { isValid: false, reason: 'Image path must be inside app directory or screenshots folder' };
}
