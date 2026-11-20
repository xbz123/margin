import jsPDF from 'jspdf';
import { flowLines } from '../lib/pdfTextFlow.mjs';
import { formatTranscriptTime, visibleTranscriptRows } from '../lib/meetingTranscriptView.mjs';

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
        answer?: string;
        items?: string[];
    }>;
}

/** The meeting PDF, not yet saved. */
export const buildMeetingPDF = (meeting: Meeting): jsPDF => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 20;
    const contentWidth = pageWidth - (margin * 2);
    let y = 20;

    // Helper for adding text with auto-page break
    const addText = (text: string, fontSize: number = 10, isBold: boolean = false, color: string = '#000000') => {
        doc.setFontSize(fontSize);
        doc.setFont('helvetica', isBold ? 'bold' : 'normal');
        doc.setTextColor(color);

        const lines = doc.splitTextToSize(text, contentWidth);

        // Write the lines that fit on this page, then continue on new pages: a block
        // longer than a page is never cut off. Lines are spaced as one doc.text(lines) call
        // spaces them: the font size (pt) times the line height factor, in mm.
        y = flowLines(doc, lines, {
            x: margin, y, lineHeight: fontSize * doc.getLineHeightFactor() / doc.internal.scaleFactor,
            top: 20, bottom: doc.internal.pageSize.getHeight() - margin,
        });
        y += 2; // Add some spacing
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
    // speakers and times. AI answers are listed under AI Usage below. The PDF font has no
    // CJK glyphs, so speaker labels stay in English.
    const transcriptRows = visibleTranscriptRows(meeting.transcript, formatTranscriptTime);
    if (transcriptRows.length > 0) {
        addText('Transcript', 14, true, '#000000');
        addVerticalSpace(2);

        transcriptRows.forEach(row => {
            // Speaker line
            addText(`${row.speakerKey} [${row.time}]`, 10, true, '#444444');
            // Text line
            addText(row.text, 10, false, '#333333');
            addVerticalSpace(2);
        });
        addVerticalSpace(8);
    }

    // --- Usage (Q&A / AI Interactions) ---
    if (meeting.usage && meeting.usage.length > 0) {
        addText('AI Usage & Interactions', 14, true, '#000000');
        addVerticalSpace(2);

        meeting.usage.forEach(item => {
            if (item.type === 'chat' && item.question && item.answer) {
                addText(`Q: ${item.question}`, 10, true, '#222222');
                addText(`A: ${item.answer}`, 10, false, '#444444');
                addVerticalSpace(3);
            }
            else if (item.type === 'assist' && item.answer) {
                addText('Assist:', 10, true, '#222222');
                addText(item.answer, 10, false, '#444444');
                addVerticalSpace(3);
            }
        });
    }

    return doc;
};

export const generateMeetingPDF = (meeting: Meeting) => {
    const doc = buildMeetingPDF(meeting);
    // Save
    const safeTitle = meeting.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    doc.save(`${safeTitle}.pdf`);
};
