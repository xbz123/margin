// The PDF export font (Noto Sans SC, subset; see src/font/NotoSansSC-2.004/README.md), as
// base64 for jsPDF's virtual file system. Imported dynamically by generateMeetingPDF only, so the
// ~2.3 MB font is a separate chunk loaded on the first export rather than with the app.
// "?base64" is loaded by scripts/margin/base64-asset.mjs (vite.config.mts).
import fontBase64 from '../font/NotoSansSC-2.004/NotoSansSC-Regular-subset.ttf?base64';

export const PDF_FONT_FILE = 'NotoSansSC-Regular-subset.ttf';
export const PDF_FONT_BASE64: string = fontBase64;
