import DOMPurify from 'dompurify';
import { Marked, Tokens } from 'marked';

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Markdown for model answers. Layers of defence (the model output is untrusted):
 *  1. raw HTML in the markdown is escaped, images are dropped
 *  2. the result is sanitised with DOMPurify
 *  3. citations like [2] become <sup class="cite" data-cite="2"> so the UI can link them to sources
 */
const marked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html: ({ text }: Tokens.HTML | Tokens.Tag) => escapeHtml(text),
    image: ({ text }: Tokens.Image) => escapeHtml(text),
  },
  extensions: [
    {
      name: 'cite',
      level: 'inline',
      start: (src: string) => src.indexOf('['),
      tokenizer(src: string) {
        const m = /^\[(\d{1,2})\]/.exec(src);
        return m ? { type: 'cite', raw: m[0], ref: Number(m[1]) } : undefined;
      },
      renderer(token: Tokens.Generic) {
        const ref = Number(token['ref']);
        return `<sup class="cite" role="button" tabindex="0" data-cite="${ref}" title="Show source ${ref}">${ref}</sup>`;
      },
    },
  ],
});

let hooked = false;
function ensureHooks(): void {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
}

export function renderMarkdown(text: string): string {
  ensureHooks();
  const html = marked.parse(text ?? '', { async: false }) as string;
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'b', 'i', 'code', 'pre', 'ul', 'ol', 'li', 'blockquote', 'a', 'h1', 'h2', 'h3', 'h4', 'sup', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'del'],
    ALLOWED_ATTR: ['href', 'class', 'role', 'tabindex', 'data-cite', 'title', 'target', 'rel'],
    ALLOW_DATA_ATTR: false,
  });
}
