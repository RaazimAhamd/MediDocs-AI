import { renderMarkdown } from './markdown';

describe('renderMarkdown', () => {
  it('renders basic markdown', () => {
    const html = renderMarkdown('**Bold** and a list:\n\n- one\n- two');
    expect(html).toContain('<strong>Bold</strong>');
    expect(html).toContain('<li>one</li>');
  });

  it('turns [n] citations into marker chips linked to the source number', () => {
    const html = renderMarkdown('Cancel 24 hours ahead [1]. A fee applies [2][3].');
    expect(html).toContain('class="cite"');
    expect(html).toContain('data-cite="1"');
    expect(html).toContain('data-cite="3"');
    expect((html.match(/class="cite"/g) ?? []).length).toBe(3);
  });

  it('never lets raw HTML or scripts through', () => {
    const html = renderMarkdown('Hi <script>alert(1)</script><img src=x onerror="alert(2)"><b onclick="x()">b</b>');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.querySelector('script')).toBeNull();
    expect(doc.querySelector('img')).toBeNull();
    expect(doc.querySelector('[onerror],[onclick]')).toBeNull();
    expect(html).toContain('&lt;script&gt;');
  });

  it('drops markdown images and neutralises javascript: links', () => {
    const html = renderMarkdown('![tracker](https://evil.example/pixel.png) [click](javascript:alert(1))');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.querySelector('img')).toBeNull();
    const link = doc.querySelector('a');
    expect(link?.getAttribute('href') ?? '').not.toContain('javascript');
  });

  it('opens external links safely', () => {
    const doc = new DOMParser().parseFromString(renderMarkdown('[site](https://example.com)'), 'text/html');
    const a = doc.querySelector('a');
    expect(a?.getAttribute('target')).toBe('_blank');
    expect(a?.getAttribute('rel')).toContain('noopener');
  });

  it('handles empty input', () => {
    expect(renderMarkdown('')).toBe('');
  });
});
