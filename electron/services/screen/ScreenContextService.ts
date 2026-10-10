// Screen context passed from the screenshot / vision pipeline to answer generation.
// The Tesseract OCR service that used to live here was removed with OCR in
// PLAN.md AG-16; only the shared type remains.

export interface ScreenContext {
    ocrText: string;      // legacy extracted-text key; no generative preanalysis runs in the answer path
    imagePath: string;
    activeWindowTitle?: string;
    timestamp: number;
    hash: string;  // perceptual hash for dedupe
    confidence?: number;
    provider?: string;
}
