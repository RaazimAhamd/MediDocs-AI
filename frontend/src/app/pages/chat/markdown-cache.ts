import { renderMarkdown } from '../../core/markdown';

const cache = new Map<string, { content: string; html: string }>();

/** Rendering markdown on every change-detection pass would be wasteful; cache by message id and content. */
export function markdownCache(id: string, content: string): string {
  const hit = cache.get(id);
  if (hit && hit.content === content) return hit.html;
  const html = renderMarkdown(content);
  cache.set(id, { content, html });
  if (cache.size > 500) cache.delete(cache.keys().next().value as string);
  return html;
}
