import PDFDocument from 'pdfkit';
import streamJson from 'stream-json';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream, readFileSync } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setImmediate as yieldTurn } from 'node:timers/promises';

// Version 2 is pinned for existing email retries. Change the version before
// changing its fonts, layout or wording; never rerender a handed-off v2 differently.
export const PDF_PRESENTATION_VERSION = 2;
const fontFiles = [
  () => readFileSync(join(process.cwd(), 'public/fonts/privacy-export/Barlow-Regular.ttf')),
  () => readFileSync(join(process.cwd(), 'public/fonts/privacy-export/NotoSans-Regular.ttf')),
  () => readFileSync(join(process.cwd(), 'public/fonts/privacy-export/NotoEmoji-Regular.ttf')),
  () => readFileSync(join(process.cwd(), 'public/fonts/privacy-export/NotoSansArabic-Regular.ttf')),
  () => readFileSync(join(process.cwd(), 'public/fonts/privacy-export/NotoSansCJKsc-Regular.otf')),
];
const labels: Record<string, string> = {
  generatedAt: 'Captured on', formatVersion: 'Data format version', fieldExplanations: 'About your data',
  sections: 'Your saved information', journal_entries: 'Journal entries', check_ins: 'Daily check-ins',
  user_profile: 'Account profile', activity_logs: 'Activities', photoManifest: 'Photo manifest',
  sharedCalendars: 'Shared calendar associations', content: 'Entry text', prompt: 'Journal prompt',
  mood_value: 'Saved mood value', created_at: 'Created on', updated_at: 'Updated on',
  user_id: 'Account identifier', id: 'Record identifier', mind_plan_actions: 'Mind plan actions',
};
export function exportFieldLabel(key: string) {
  return labels[key] ?? key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
}

/** Incremental JSON tokens, bounded text blocks, one PDF page at a time.
 * Private output is spooled to disk, not accumulated as a giant Buffer.
 * Caller MUST dispose in finally, including cancelled downloads.
 */
export async function renderExportPdf(chunks: AsyncIterable<string>, generatedAt: string, signal?: AbortSignal) {
  const captured = new Date(generatedAt);
  if (!Number.isFinite(captured.getTime())) throw new Error('Invalid capture timestamp');
  const dir = await mkdtemp(join(tmpdir(), 'dadhealth-export-'));
  const path = join(dir, 'report.pdf');
  const dispose = () => rm(dir, { recursive: true, force: true });
  const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: false, fontLayoutCache: false, font: fontFiles[0](),
    info: { Title: 'Your Dad Health data', Author: 'Dad Health', CreationDate: captured, ModDate: captured },
    compress: true });
  const output = createWriteStream(path, { mode: 0o600 });
  let outputError: unknown;
  const writing = pipeline(doc, output).catch(error => { outputError = error; });
  const abort = () => doc.destroy(new Error('Export cancelled'));
  signal?.addEventListener('abort', abort, { once: true });
  const input = Readable.from(chunks);
  const tokens = streamJson.parser({ packKeys: true, streamKeys: false, packStrings: false, packNumbers: false });
  const parsing = pipeline(input, tokens).catch(error => { tokens.destroy(error); });
  try {
    const fonts = fontFiles.map((read, i) => {
      doc.registerFont(`privacy-${i}`, read()); doc.font(`privacy-${i}`);
      return { name: `privacy-${i}`, font: doc._font.font };
    });
    doc.registerFont('heading', readFileSync(join(process.cwd(), 'public/fonts/privacy-export/BarlowCondensed-Bold.ttf')));
    const headingFont = { name: 'heading', font: (doc.font('heading'), doc._font.font) };
    let page = 0;
    const bottom = doc.page.height - 60;
    let cursor = 48;
    const pageBackground = () => {
      page++;
      doc.rect(0, 0, doc.page.width, doc.page.height).fill('#0A0A0A');
      doc.moveTo(48, doc.page.height - 45).lineTo(doc.page.width - 48, doc.page.height - 45).strokeColor('#303030').stroke();
      doc.font('privacy-0').fontSize(9).fillColor('#D9D9D9')
        .text(`Dad Health - Personal information | Page ${page}`, 48, doc.page.height - 33, { lineBreak: false });
      cursor = 48;
    };
    doc.on('pageAdded', pageBackground); pageBackground();
    const Segmenter = (Intl as unknown as { Segmenter: new (locale: string, options: { granularity: string }) => {
      segment(value: string): Iterable<{ segment: string }>;
    } }).Segmenter;
    const segmenter = new Segmenter('en', { granularity: 'grapheme' });
    type Run = { font: string; text: string; width: number };
    type Line = { runs: Run[]; size: number; height: number; heading: boolean };
    const width = doc.page.width - 132;
    const pending: Line[] = [];
    const widths = new Map<string, number>();
    const glyphs = new Map<string, { name: string; rendered: string }>();
    let context = 'Saved information';
    // Bounded field fragments and explicit line layout keep cards off the footer.
    // No automatic font shrinking, buffered PDF pages or whole-record materialization.
    function lines(value: string, size: number, heading: boolean): Line[] {
      const result: Line[] = [];
      let runs: Run[] = [], used = 0;
      const finish = () => { result.push({ runs, size, height: heading ? size + 6 : 18, heading }); runs = []; used = 0; };
      const preferred = heading ? [headingFont, ...fonts] : fonts;
      function add(part: string) {
        for (const { segment } of segmenter.segment(part)) {
          const glyphKey = `${heading}:${segment}`;
          let glyph = glyphs.get(glyphKey);
          if (!glyph) {
            const points = Array.from(segment);
            const font = preferred.find(f => points.every(c => f.font.hasGlyphForCodePoint(c.codePointAt(0))));
            glyph = { name: font?.name ?? 'privacy-0', rendered: font ? segment :
              `[${points.map(c => `U+${c.codePointAt(0)!.toString(16).toUpperCase()}`).join(' ')}]` };
            if (glyphs.size >= 4096) glyphs.clear();
            glyphs.set(glyphKey, glyph);
          }
          const { name, rendered } = glyph;
          const metricKey = `${name}:${size}:${rendered}`;
          let w = widths.get(metricKey);
          if (w === undefined) {
            w = doc.font(name).fontSize(size).widthOfString(rendered);
            if (widths.size >= 4096) widths.clear();
            widths.set(metricKey, w);
          }
          if (used + w > width && runs.length) finish();
          const last = runs.at(-1);
          if (last?.font === name) { last.text += rendered; last.width += w; }
          else runs.push({ font: name, text: rendered, width: w });
          used += w;
        }
      }
      for (const part of (value || '(Empty text)').split(/(\r\n|\n|\r|[^\S\r\n]+)/)) {
        if (!part) continue;
        if (/^[\r\n]+$/.test(part)) { finish(); continue; }
        const normalized = part.replace(/\t/g, '    ');
        // Move complete words when possible; very long identifiers wrap safely.
        const estimateKey = `word:${heading}:${size}:${normalized}`;
        let estimate = widths.get(estimateKey);
        if (estimate === undefined) {
          estimate = doc.font(heading ? 'heading' : 'privacy-0').fontSize(size).widthOfString(normalized);
          if (widths.size >= 4096) widths.clear();
          widths.set(estimateKey, estimate);
        }
        if (!/^\s+$/.test(normalized) && used && used + estimate > width) finish();
        add(normalized);
      }
      if (runs.length || !result.length) finish();
      return result;
    }
    function text(value: string, size = 10, _indent = 0, continuation = false) {
      if (size > 10) {
        context = value;
        pending.push(...lines(value, size >= 22 ? 28 : 18, true));
        return;
      }
      let remaining = [...pending.splice(0), ...lines(value, 12, false)];
      let continued = continuation;
      while (remaining.length) {
        const heading = continued ? lines(`${context} (continued)`, 14, true) : [];
        const total = [...heading, ...remaining].reduce((sum, line) => sum + line.height, 36);
        const firstBody = remaining.findIndex(line => !line.heading);
        const minimum = heading.reduce((sum, line) => sum + line.height, 36) +
          remaining.slice(0, Math.max(firstBody + 1, 1)).reduce((sum, line) => sum + line.height, 0);
        if (cursor > 48 && (!continued && total <= bottom - 48 && cursor + total > bottom || cursor + minimum > bottom)) doc.addPage();
        const available = bottom - cursor - 36;
        const selected = [...heading];
        let height = heading.reduce((sum, line) => sum + line.height, 0), count = 0;
        while (count < remaining.length && height + remaining[count].height <= available) {
          height += remaining[count].height; selected.push(remaining[count++]);
        }
        if (!count) throw new Error('Export field heading exceeds page capacity');
        doc.roundedRect(48, cursor, doc.page.width - 96, height + 36, 16).fill('#151515');
        let y = cursor + 18;
        for (const line of selected) {
          let x = 66;
          for (const run of line.runs) {
            doc.font(run.font).fontSize(line.size).fillColor(line.heading ? '#C8F55A' : '#FFFFFF')
              .text(run.text, x, y, { lineBreak: false });
            x += run.width;
          }
          y += line.height;
        }
        cursor += height + 48;
        remaining = remaining.slice(count);
        if (remaining.length) { doc.addPage(); continued = true; }
      }
    }
    text('Your Dad Health data', 22);
    text(`Captured on: ${generatedAt}`, 10);
    text('These files contain personal information. Keep them somewhere safe.');
    text('Photos are listed in the photo manifest, not attached. Unsynced device-only drafts are not included.');
    text('No saved value (null) differs from empty text, zero and an empty list. Unsupported symbols are shown as Unicode code points (U+...) and remain unchanged in the JSON copy.');
    doc.moveDown();
    const stack: Array<{ type: string; count: number }> = [];
    let key = '', value = '', scalar = false, scalarWritten = false;
    function beginValue() {
      const parent = stack.at(-1);
      if (parent?.type === 'array') { parent.count++; text(`Item ${parent.count}`, 11, stack.length - 1); }
      else if (key) { if (parent) parent.count++; text(exportFieldLabel(key), 13, stack.length - 1); }
      key = '';
    }
    function flush(final: boolean) {
      if (final || value.length >= 2048) {
        // Keep a high surrogate together with its low surrogate across chunks.
        const keep = !final && /[\uD800-\uDBFF]$/.test(value) ? value.slice(-1) : '';
        const printable = keep ? value.slice(0, -1) : value;
        if (printable || final && !scalarWritten) { text(printable, 10, stack.length, scalarWritten); scalarWritten = true; }
        value = keep;
      }
    }
    for await (const token of tokens) {
      signal?.throwIfAborted();
      if (outputError) throw outputError;
      switch (token.name) {
        case 'keyValue': key = token.value; break;
        case 'startObject': case 'startArray':
          beginValue(); stack.push({ type: token.name === 'startArray' ? 'array' : 'object', count: 0 }); break;
        case 'endObject': case 'endArray': {
          const item = stack.pop();
          if (item?.count === 0) text(item.type === 'array' ? 'No saved items (empty list)' : 'No saved fields (empty object)', 10, stack.length);
          doc.moveDown(0.25); break;
        }
        case 'startString': case 'startNumber': beginValue(); value = ''; scalar = true; scalarWritten = false; break;
        case 'stringChunk': case 'numberChunk': value += token.value; flush(false); break;
        case 'endString': case 'endNumber': flush(true); scalar = false; break;
        case 'nullValue': beginValue(); text('No saved value (null)', 10, stack.length); break;
        case 'trueValue': case 'falseValue': beginValue(); text(token.name === 'trueValue' ? 'True' : 'False', 10, stack.length); break;
      }
      // Respect downstream disk backpressure, including highly compressible
      // or very long fields. There is no record/page truncation or export cap.
      while (doc.readableLength > 65536 && !doc.destroyed) { signal?.throwIfAborted(); await yieldTurn(); }
    }
    await parsing;
    if (scalar || stack.length) throw new Error('Incomplete capture');
    doc.end(); await writing;
    if (outputError) throw outputError;
    return { path, bytes: (await stat(path)).size, pages: page, dispose };
  } catch (error) {
    input.destroy(); tokens.destroy(); doc.destroy(); output.destroy();
    await writing; await dispose(); throw error;
  } finally { signal?.removeEventListener('abort', abort); }
}
