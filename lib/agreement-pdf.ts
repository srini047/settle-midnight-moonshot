import { jsPDF } from 'jspdf';

export type AgreementPdfInput = {
  title: string;
  roomId: string;
  revision: string;
  content: string;
};

export function createAgreementPdf(input: AgreementPdfInput): { pdf: jsPDF; pageCount: number } {
  const pdf = new jsPDF();
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 18;
  const lineHeight = 5;
  const contentLines = pdf.splitTextToSize(input.content, pageWidth - margin * 2) as string[];
  let y = 20;

  pdf.setFontSize(16);
  pdf.text(input.title, margin, y);
  y += 8;
  pdf.setFontSize(10);
  pdf.text(`Settle agreement · ${input.roomId} · Revision ${input.revision}`, margin, y);
  y += 14;
  pdf.setFontSize(11);

  for (const line of contentLines) {
    if (y > pageHeight - margin) {
      pdf.addPage();
      y = margin;
    }
    pdf.text(line, margin, y);
    y += lineHeight;
  }

  return { pdf, pageCount: pdf.getNumberOfPages() };
}
