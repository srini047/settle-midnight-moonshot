import OpenAI from 'openai';
import mammoth from 'mammoth';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const MAX_FILES = 5;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

type ExtractedFile = {
  name: string;
  mimeType: string;
  text: string;
  imageDataUrl?: string;
};

type ExtractedTerm = {
  name: string;
  valueA: string;
  unit: string;
  valueKind: string;
  reasonA: string;
};

function normalizeTerms(input: unknown): ExtractedTerm[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  return input
    .map(item => {
      const term = item as Record<string, unknown>;
      return {
        name: String(term.name ?? '').trim(),
        valueA: String(term.valueA ?? '').replace(/\s+/g, ' ').trim(),
        unit: String(term.unit ?? '').replace(/\s+/g, ' ').trim(),
        valueKind: String(term.valueKind ?? 'free_text').trim() || 'free_text',
        reasonA: String(term.reasonA ?? '').replace(/\s+/g, ' ').trim(),
      };
    })
    .filter(term => {
      const key = term.name.toLowerCase().replace(/\s+/g, ' ');
      const looksLikeNarrative = term.valueA.length > 90 || /[.!?]\s/.test(term.valueA) || /^(this|the|context|the listing|the property)\b/i.test(term.valueA);
      if (!key || !term.valueA || looksLikeNarrative || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function openAiFailure(error: unknown): { message: string; status: number } {
  const candidate = error as { status?: number; code?: string; message?: string } | null;
  const message = candidate?.message ?? '';
  if (candidate?.status === 429 || candidate?.code === 'insufficient_quota' || /quota|credits remaining|rate limit/i.test(message)) {
    return {
      message: 'The analysis service has no available credits right now. Add OpenAI API credits or update OPENAI_API_KEY, then try again.',
      status: 429,
    };
  }
  if (candidate?.status === 401 || candidate?.status === 403) {
    return { message: 'The analysis service rejected OPENAI_API_KEY. Check the configured API key, then try again.', status: 503 };
  }
  return { message: 'The analysis service is temporarily unavailable. Please try again.', status: 502 };
}

async function extractFile(file: File): Promise<ExtractedFile> {
  if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} is larger than 2 MB.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const lowerName = file.name.toLowerCase();
  const isImage = file.type.startsWith('image/');
  const isPdf = file.type === 'application/pdf' || lowerName.endsWith('.pdf');
  const isDocx = file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || lowerName.endsWith('.docx');
  const isText = file.type.startsWith('text/') || /\.(txt|md|csv|json)$/i.test(file.name);

  if (isImage) {
    return {
      name: file.name,
      mimeType: file.type || 'image/*',
      text: `Image attachment: ${file.name}`,
      imageDataUrl: `data:${file.type || 'image/jpeg'};base64,${Buffer.from(bytes).toString('base64')}`,
    };
  }
  if (isPdf) {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: bytes });
    try {
      const result = await parser.getText();
      return { name: file.name, mimeType: file.type || 'application/pdf', text: result.text };
    } finally {
      await parser.destroy();
    }
  }
  if (isDocx) {
    const result = await mammoth.extractRawText({ arrayBuffer: bytes.slice().buffer });
    return { name: file.name, mimeType: file.type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', text: result.value };
  }
  if (isText) {
    return { name: file.name, mimeType: file.type || 'text/plain', text: new TextDecoder().decode(bytes) };
  }
  throw new Error(`${file.name} is not supported. Use PDF, DOCX, TXT, or an image.`);
}

export async function POST(request: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'OPENAI_API_KEY is not configured' }, { status: 503 });
  }

  const form = await request.formData();
  const context = String(form.get('context') ?? '').trim();
  const propertyType = String(form.get('propertyType') ?? 'residential');
  const state = String(form.get('state') ?? '');
  const city = String(form.get('city') ?? '');
  const files = form.getAll('files').filter((value): value is File => value instanceof File);
  if (context.length < 20 && files.length === 0) return NextResponse.json({ error: 'Add rental context or a supporting file first' }, { status: 400 });
  if (files.length > MAX_FILES) return NextResponse.json({ error: `You can attach up to ${MAX_FILES} files.` }, { status: 400 });

  try {
    const extracted = await Promise.all(files.map(extractFile));
    const sourceText = extracted.map(file => `\n--- ${file.name} (${file.mimeType}) ---\n${file.text.slice(0, 12000)}`).join('\n');
    const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
      {
        type: 'text',
        text: `Rental context:\n${context}\n\nExtracted file text:\n${sourceText || 'No text extracted from attachments.'}`,
      },
      ...extracted.filter(file => file.imageDataUrl).map(file => ({
        type: 'image_url' as const,
        image_url: { url: file.imageDataUrl!, detail: 'high' as const },
      })),
    ];
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.chat.completions.create({
      model: process.env.MEDIATOR_MODEL ?? 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      temperature: 0.1,
      messages: [
        {
          role: 'system',
          content: `Extract concise rental values from an Indian ${propertyType} rental matter in ${city}, ${state}. Inspect all attached images carefully, including visible numbers, prices, dates, labels, and document text. Return only JSON: {"terms":[{"name":"short term name","valueA":"short concrete value only","unit":"currency, duration, or other unit","valueKind":"currency|number|date|free_text","reasonA":"short explicit reason or empty"}]}. Examples: valueA "40000", unit "INR/month"; valueA "80000", unit "INR"; valueA "60", unit "days"; valueA "short term", unit ""; valueA "included", unit "". Each valueA must be a value, not a paragraph or context summary. Preserve the language and meaning of values; do not invent facts, values, reasons, or legal conclusions. Concrete rental facts visible in a listing or document, such as rent, deposit, duration, notice, furnishing, utilities, or included amenities, may be returned as suggested values for the initiator to review. Ignore general property description when it has no concrete rental value. Return an empty terms array only when no concrete rental value can be found in the context or attachments.`,
        },
        { role: 'user', content },
      ],
    });
    const raw = response.choices[0]?.message?.content;
    if (!raw) throw new Error('Extraction returned empty output');
    const parsed = JSON.parse(raw) as { terms?: unknown };
    let terms = normalizeTerms(parsed.terms);
    if (terms.length === 0) {
      if (!process.env.TAVILY_API_KEY) throw new Error('TAVILY_API_KEY is required to estimate a market value when the documents contain no stated rent');
      const marketResponse = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: process.env.TAVILY_API_KEY,
          query: `current monthly rent for a ${propertyType} rental in ${city}, ${state}, India based on the property details below. Return local market evidence, not legal advice.\n${context}`,
          search_depth: 'advanced',
          max_results: 5,
          include_answer: false,
          include_raw_content: true,
        }),
      });
      if (!marketResponse.ok) throw new Error(`Market research failed (${marketResponse.status})`);
      const market = (await marketResponse.json()) as { results?: Array<{ title?: string; url?: string; content?: string; raw_content?: string }> };
      const marketText = (market.results ?? []).map(result => `${result.title ?? ''}\n${result.content ?? result.raw_content ?? ''}`).join('\n\n').slice(0, 30000);
      const estimate = await client.chat.completions.create({
        model: process.env.MEDIATOR_MODEL ?? 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        temperature: 0.1,
        messages: [
          {
            role: 'system',
            content: `Create a rental opening value from property context and local market evidence. Return only JSON: {"terms":[{"name":"Suggested market rent","valueA":"short range or value","unit":"INR/month","valueKind":"currency","reasonA":"clearly say this is a market estimate and not a verified fact"}]}. You must return one suggested value when possible. Never present an estimate as a fact or legal requirement.`,
          },
          { role: 'user', content: `Property context:\n${context}\n\nMarket evidence:\n${marketText}` },
        ],
      });
      const estimateRaw = estimate.choices[0]?.message?.content;
      const estimateParsed = estimateRaw ? JSON.parse(estimateRaw) as { terms?: unknown } : {};
      terms = normalizeTerms(estimateParsed.terms).map(term => ({
        ...term,
        reasonA: term.reasonA || 'Suggested from current local market evidence; verify before negotiating.',
      }));
      if (terms.length === 0) throw new Error('No rental value could be estimated from the supplied context and market evidence');
    }
    return NextResponse.json({ terms });
  } catch (error) {
    const failure = openAiFailure(error);
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
}
