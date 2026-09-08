// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';

// ---------------------------------------------------------------------------
// Body rendering
// ---------------------------------------------------------------------------

/**
 * Block-level parse of a post body. The rate-change drafts (the only
 * publisher at launch) emit plain-text markdown: paragraphs separated
 * by blank lines, an optional label line ("Mitä muuttuu:") directly
 * followed by `- ` bullet lines. This renderer covers exactly those
 * blocks — consecutive `- ` lines group into a list item block,
 * everything else is a paragraph. No inline markup interpretation, no
 * HTML passthrough. Anything unexpected renders as a plain paragraph,
 * so a future publisher can never inject markup through a post body.
 *
 * Returns raw strings as children (React escapes them); the caller
 * supplies the wrapping elements per block.
 */
export function parsePostBody(
  bodyMarkdown: string,
): Array<{ kind: 'paragraph' | 'list'; lines: readonly string[] }> {
  const blocks: Array<{
    kind: 'paragraph' | 'list';
    lines: readonly string[];
  }> = [];

  const text = bodyMarkdown.replace(/\r\n/g, '\n');

  for (const rawBlock of text.split(/\n{2,}/)) {
    let paragraph: string[] = [];
    let list: string[] = [];

    const flush = () => {
      if (paragraph.length > 0) {
        blocks.push({ kind: 'paragraph', lines: [paragraph.join(' ').trim()] });
        paragraph = [];
      }
      if (list.length > 0) {
        blocks.push({ kind: 'list', lines: list });
        list = [];
      }
    };

    for (const rawLine of rawBlock.split('\n')) {
      const line = rawLine.trim();
      if (line.startsWith('- ')) {
        list.push(line.slice(2).trim());
      } else if (line !== '') {
        paragraph.push(line);
      }
    }
    flush();
  }
  return blocks;
}

/**
 * Render the parsed blocks. Plain strings only — React escapes the
 * content, so no post body can smuggle markup into the page.
 */
export default function BlogPostBody({ bodyMarkdown }: { bodyMarkdown: string }) {
  const blocks = parsePostBody(bodyMarkdown);

  return (
    <div data-testid="blog-post-body" className="space-y-4">
      {blocks.map((block, index) =>
        block.kind === 'list' ? (
          <ul key={index} className="ml-5 list-disc space-y-1">
            {block.lines.map((line, lineIndex) => (
              <li
                key={lineIndex}
                className="text-sm leading-relaxed text-gray-700"
              >
                {line}
              </li>
            ))}
          </ul>
        ) : (
          <p key={index} className="text-sm leading-relaxed text-gray-700">
            {block.lines[0]}
          </p>
        ),
      )}
    </div>
  );
}
