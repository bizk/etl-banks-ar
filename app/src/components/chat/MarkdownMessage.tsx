import { Fragment, type ReactNode } from 'react';

/**
 * Tiny, dependency-free markdown renderer for assistant replies.
 * Supports: headings (#..###), paragraphs, bullet & numbered lists,
 * fenced code blocks, **bold**, *italic* / _italic_ and `inline code`.
 * Everything is rendered as React elements (no raw HTML injection).
 */

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[]; start: number }
  | { kind: 'code'; text: string };

const BULLET_RE = /^\s*[-*•]\s+(.*)$/;
const ORDERED_RE = /^\s*(\d+)[.)]\s+(.*)$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ kind: 'paragraph', text: paragraph.join('\n') });
      paragraph = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim().startsWith('```')) {
      flushParagraph();
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        code.push(lines[i]);
        i++;
      }
      blocks.push({ kind: 'code', text: code.join('\n') });
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2] });
      continue;
    }

    const bullet = BULLET_RE.exec(line);
    if (bullet) {
      flushParagraph();
      const last = blocks[blocks.length - 1];
      if (last?.kind === 'ul') last.items.push(bullet[1]);
      else blocks.push({ kind: 'ul', items: [bullet[1]] });
      continue;
    }

    const ordered = ORDERED_RE.exec(line);
    if (ordered) {
      flushParagraph();
      const last = blocks[blocks.length - 1];
      if (last?.kind === 'ol') last.items.push(ordered[2]);
      else blocks.push({ kind: 'ol', items: [ordered[2]], start: Number(ordered[1]) || 1 });
      continue;
    }

    // Indented continuation of a list item.
    const last = blocks[blocks.length - 1];
    if (!paragraph.length && /^\s{2,}\S/.test(line) && (last?.kind === 'ul' || last?.kind === 'ol')) {
      last.items[last.items.length - 1] += ' ' + line.trim();
      continue;
    }

    paragraph.push(line);
  }
  flushParagraph();
  return blocks;
}

const INLINE_RE = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;

function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  for (const match of text.matchAll(INLINE_RE)) {
    const token = match[0];
    const index = match.index ?? 0;
    if (index > lastIndex) out.push(text.slice(lastIndex, index));
    if (token.startsWith('**') || token.startsWith('__')) {
      out.push(<strong key={key++} className="font-semibold">{renderInline(token.slice(2, -2))}</strong>);
    } else if (token.startsWith('`')) {
      out.push(
        <code key={key++} className="px-1.5 py-0.5 rounded bg-surface-container-high text-[0.85em] font-mono">
          {token.slice(1, -1)}
        </code>
      );
    } else {
      out.push(<em key={key++}>{token.slice(1, -1)}</em>);
    }
    lastIndex = index + token.length;
  }
  if (lastIndex < text.length) out.push(text.slice(lastIndex));
  return out;
}

function renderWithLineBreaks(text: string): ReactNode {
  const lines = text.split('\n');
  return lines.map((line, i) => (
    <Fragment key={i}>
      {renderInline(line)}
      {i < lines.length - 1 && <br />}
    </Fragment>
  ));
}

export function MarkdownMessage({ content }: { content: string }) {
  const blocks = parseBlocks(content);
  return (
    <div className="space-y-3 leading-relaxed">
      {blocks.map((block, i) => {
        switch (block.kind) {
          case 'heading':
            return (
              <p
                key={i}
                className={`font-headline font-bold text-on-surface ${block.level <= 2 ? 'text-base' : 'text-sm'}`}
              >
                {renderInline(block.text)}
              </p>
            );
          case 'ul':
            return (
              <ul key={i} className="list-disc pl-5 space-y-1 marker:text-primary">
                {block.items.map((item, j) => (
                  <li key={j}>{renderInline(item)}</li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={i} start={block.start} className="list-decimal pl-5 space-y-1 marker:text-primary marker:font-semibold">
                {block.items.map((item, j) => (
                  <li key={j}>{renderInline(item)}</li>
                ))}
              </ol>
            );
          case 'code':
            return (
              <pre
                key={i}
                className="p-3 rounded-xl bg-surface-container-high text-xs font-mono overflow-x-auto whitespace-pre"
              >
                {block.text}
              </pre>
            );
          default:
            return <p key={i}>{renderWithLineBreaks(block.text)}</p>;
        }
      })}
    </div>
  );
}
