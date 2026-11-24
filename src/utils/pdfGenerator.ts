import jsPDF from 'jspdf';
import { flowLines, wrapParagraphs, type TextFlowTarget } from '../lib/pdfTextFlow.mjs';
import { formatTranscriptTime, visibleTranscriptRows } from '../lib/meetingTranscriptView.mjs';
import { usageExportBlocks } from '../lib/meetingUsageExport.mjs';

interface Meeting {
    id: string;
    title: string;
    date: string;
    duration: string;
    transcript?: Array<{
        speaker: string;
        text: string;
        timestamp: number;
    }>;
    usage?: Array<{
        type: 'assist' | 'followup' | 'chat' | 'followup_questions';
        timestamp: number;
        question?: string;
        // The localized text the user saw for the question; printed in place of `question`.
        displayQuestion?: string;
        answer?: string;
        items?: string[];
    }>;
}

export interface MeetingPDFOptions {
    /** Base64 TrueType font covering Chinese; without it the PDF falls back to Helvetica (Latin only). */
    fontBase64?: string;
    fontFile?: string;
    /** UI translation for labels and headings (English keys). */
    translate?: (key: string) => string;
}

const FONT_NAME = 'MarginExport';

/** The meeting PDF, not yet saved. */
export const buildMeetingPDF = (meeting: Meeting, options: MeetingPDFOptions = {}): jsPDF => {
    const doc = new jsPDF();
    const t = options.translate ?? ((key: string) => key);
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 20;
    const contentWidth = pageWidth - (margin * 2);
    let y = 20;

    // One font for every line: Noto Sans SC covers Chinese and Latin. It has a single weight, so
    // "bold" text is filled and outlined in its own colour.
    const hasCjkFont = Boolean(options.fontBase64);
    if (hasCjkFont) {
        const file = options.fontFile ?? 'MarginExport.ttf';
        doc.addFileToVFS(file, options.fontBase64!);
        doc.addFont(file, FONT_NAME, 'normal');
    }

    const setStyle = (fontSize: number, isBold: boolean, color: string) => {
        doc.setFontSize(fontSize);
        doc.setFont(hasCjkFont ? FONT_NAME : 'helvetica', hasCjkFont || !isBold ? 'normal' : 'bold');
        doc.setTextColor(color);
        doc.setDrawColor(color);
        doc.setLineWidth(fontSize * 0.012);
    };

    const target = (isBold: boolean, bulletX?: number): TextFlowTarget => {
        let bulletPending = bulletX !== undefined;
        const fauxBold = isBold && hasCjkFont;
        return {
            text: (line: string, x: number, lineY: number) => {
                if (bulletPending) {
                    doc.text('•', bulletX!, lineY);
                    bulletPending = false;
                }
                return fauxBold ? doc.text(line, x, lineY, { renderingMode: 'fillThenStroke' }) : doc.text(line, x, lineY);
            },
            addPage: () => doc.addPage(),
        };
    };

    // Lines are spaced as one doc.text(lines) call spaces them: the font size (pt) times the
    // line height factor, in mm. Lines that do not fit continue on new pages (flowLines), so a
    // block longer than a page is never cut off or repeated.
    // Text is wrapped one paragraph at a time (wrapParagraphs), so every hard line break stays
    // where it was and a paragraph starting with "." or ")" is not joined to the one before.
    const flow = (text: string, width: number, fontSize: number, isBold: boolean, x: number, bulletX?: number) => {
        const lines = wrapParagraphs(text, paragraph => doc.splitTextToSize(paragraph, width));
        y = flowLines(target(isBold, bulletX), lines, {
            x, y, lineHeight: fontSize * doc.getLineHeightFactor() / doc.internal.scaleFactor,
            top: 20, bottom: doc.internal.pageSize.getHeight() - margin,
        });
    };

    const addText = (text: string, fontSize: number = 10, isBold: boolean = false, color: string = '#000000') => {
        setStyle(fontSize, isBold, color);
        flow(text, contentWidth, fontSize, isBold, margin);
        y += 2; // Add some spacing
    };

    /** One list item: a bullet, then the item wrapped with a hanging indent. */
    const addBullet = (text: string, fontSize: number = 10, color: string = '#444444') => {
        const indent = 5;
        setStyle(fontSize, false, color);
        flow(text, contentWidth - indent, fontSize, false, margin + indent, margin + 1);
        y += 1;
    };

    const addVerticalSpace = (amount: number) => {
        y += amount;
    };

    // --- Header ---
    addText(meeting.title, 18, true, '#000000');
    addVerticalSpace(2);
    addText(`${meeting.date} • ${meeting.duration}`, 10, false, '#666666');
    addVerticalSpace(10);

    // --- Transcript ---
    // The rows the transcript page and its copy show: spoken lines only, with the same
    // speakers and times. AI answers are listed under AI Usage below.
    const transcriptRows = visibleTranscriptRows(meeting.transcript, formatTranscriptTime);
    if (transcriptRows.length > 0) {
        addText(t('Transcript'), 14, true, '#000000');
        addVerticalSpace(2);

        transcriptRows.forEach(row => {
            // Speaker line; without the Chinese font the label stays in English.
            addText(`${hasCjkFont ? t(row.speakerKey) : row.speakerKey} [${row.time}]`, 10, true, '#444444');
            // Text line
            addText(row.text, 10, false, '#333333');
            addVerticalSpace(2);
        });
        addVerticalSpace(8);
    }

    // --- Usage (Q&A / AI Interactions) ---
    // Labels are translated only with the Chinese font, as the other labels here.
    const blocks = usageExportBlocks(meeting.usage, hasCjkFont ? t : undefined);
    if (blocks.length > 0) {
        addText(t('AI Usage & Interactions'), 14, true, '#000000');
        addVerticalSpace(2);

        blocks.forEach(block => {
            if (block.kind === 'chat') {
                addText(`Q: ${block.question}`, 10, true, '#222222');
                addText(`A: ${block.answer}`, 10, false, '#444444');
            } else {
                const label = hasCjkFont ? t(block.label!) : block.label;
                addText(block.request ? `${label}: ${block.request}` : `${label}:`, 10, true, '#222222');
                if (block.answer) addText(block.answer, 10, false, '#444444');
                block.bullets?.forEach(question => addBullet(question));
            }
            addVerticalSpace(3);
        });
    }

    return doc;
};

/** Builds the meeting PDF with the Chinese-capable font (loaded on first export) and saves it. */
export const generateMeetingPDF = async (meeting: Meeting, translate?: (key: string) => string) => {
    let font: { PDF_FONT_BASE64: string; PDF_FONT_FILE: string } | undefined;
    try {
        font = await import('./pdfCjkFont');
    } catch (error) {
        console.error('[pdfGenerator] Export font failed to load; exporting with Helvetica', error);
    }
    const doc = buildMeetingPDF(meeting, { fontBase64: font?.PDF_FONT_BASE64, fontFile: font?.PDF_FONT_FILE, translate });
    // Save
    const safeTitle = meeting.title.replace(/[^\p{L}\p{N}]/gu, '_').toLowerCase() || 'meeting';
    doc.save(`${safeTitle}.pdf`);
};
