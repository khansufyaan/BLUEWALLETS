/**
 * Documentation Viewer — renders markdown files as styled HTML pages.
 *
 * Uses a lightweight markdown-to-HTML converter (no external deps).
 */

async function fetchMarkdown(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.text();
}

/** Minimal markdown → HTML renderer (handles headings, code, lists, tables, links, bold, italic). */
function renderMarkdown(md) {
  let html = md
    // Escape HTML entities
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Code blocks (```...```)
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
      `<pre class="doc-code-block"><code class="lang-${lang || 'text'}">${code.trim()}</code></pre>`)
    // Inline code
    .replace(/`([^`]+)`/g, '<code class="doc-inline-code">$1</code>')
    // Headings
    .replace(/^#### (.+)$/gm, '<h4 class="doc-h4">$1</h4>')
    .replace(/^### (.+)$/gm, '<h3 class="doc-h3">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="doc-h2">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="doc-h1">$1</h1>')
    // Horizontal rules
    .replace(/^---$/gm, '<hr class="doc-hr">')
    // Bold + italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="doc-link" target="_blank" rel="noopener">$1</a>')
    // Tables
    .replace(/^\|(.+)\|$/gm, (line) => {
      const cells = line.split('|').filter(c => c.trim());
      if (cells.every(c => /^[\s-:]+$/.test(c))) return '<!--table-sep-->';
      const tag = 'td';
      return '<tr>' + cells.map(c => `<${tag} class="doc-td">${c.trim()}</${tag}>`).join('') + '</tr>';
    })
    // Unordered lists
    .replace(/^[\s]*[-*] (.+)$/gm, '<li class="doc-li">$1</li>')
    // Ordered lists
    .replace(/^[\s]*\d+\. (.+)$/gm, '<li class="doc-li-ordered">$1</li>')
    // Paragraphs (blank line separated)
    .replace(/\n\n/g, '</p><p class="doc-p">')
    .replace(/\n/g, '<br>');

  // Wrap consecutive <li> in <ul>
  html = html.replace(/((?:<li class="doc-li">.+?<\/li>\s*(?:<br>)?)+)/g, '<ul class="doc-ul">$1</ul>');
  html = html.replace(/((?:<li class="doc-li-ordered">.+?<\/li>\s*(?:<br>)?)+)/g, '<ol class="doc-ol">$1</ol>');

  // Wrap consecutive <tr> in <table>
  html = html.replace(/((?:<tr>.+?<\/tr>\s*(?:<br>)?|<!--table-sep-->(?:<br>)?)+)/g, (match) => {
    const cleaned = match.replace(/<!--table-sep-->(<br>)?/g, '').replace(/<br>/g, '');
    return `<table class="doc-table">${cleaned}</table>`;
  });

  // Clean up stray <br> inside blocks
  html = html.replace(/<br><\/p>/g, '</p>');
  html = html.replace(/<pre/g, '</p><pre').replace(/<\/pre>/g, '</pre><p class="doc-p">');

  return `<div class="doc-container"><p class="doc-p">${html}</p></div>`;
}

export async function renderApiDocs() {
  try {
    const md = await fetchMarkdown('/docs/api-docs.md');
    return `
      <div class="card" style="padding:var(--sp-6)">
        <style>${docStyles()}</style>
        ${renderMarkdown(md)}
      </div>`;
  } catch (e) {
    return `<div class="card" style="padding:var(--sp-6);text-align:center;color:var(--text-tertiary)">
      <p>Failed to load API documentation: ${e.message}</p>
    </div>`;
  }
}

export async function renderWhitepaper() {
  try {
    const md = await fetchMarkdown('/docs/whitepaper.md');
    return `
      <div class="card" style="padding:var(--sp-6)">
        <style>${docStyles()}</style>
        ${renderMarkdown(md)}
      </div>`;
  } catch (e) {
    return `<div class="card" style="padding:var(--sp-6);text-align:center;color:var(--text-tertiary)">
      <p>Failed to load whitepaper: ${e.message}</p>
    </div>`;
  }
}

function docStyles() {
  return `
    .doc-container { max-width: 860px; line-height: 1.8; color: var(--text-secondary); }
    .doc-h1 { font-size: 28px; font-weight: 700; color: var(--text-primary); margin: 32px 0 16px; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
    .doc-h2 { font-size: 22px; font-weight: 600; color: var(--text-primary); margin: 28px 0 12px; padding-bottom: 6px; border-bottom: 1px solid var(--border); }
    .doc-h3 { font-size: 17px; font-weight: 600; color: var(--text-primary); margin: 24px 0 8px; }
    .doc-h4 { font-size: 14px; font-weight: 600; color: var(--text-primary); margin: 20px 0 6px; }
    .doc-p { font-size: 13px; margin: 0 0 12px; }
    .doc-hr { border: none; border-top: 1px solid var(--border); margin: 24px 0; }
    .doc-code-block { background: var(--bg-elevated); border-radius: var(--r-md); padding: 16px; overflow-x: auto; margin: 16px 0; }
    .doc-code-block code { font-size: 12px; color: var(--text-secondary); font-family: 'JetBrains Mono', monospace; white-space: pre; }
    .doc-inline-code { background: var(--bg-elevated); padding: 2px 6px; border-radius: 4px; font-size: 12px; color: var(--blue-400); font-family: 'JetBrains Mono', monospace; }
    .doc-link { color: var(--blue-400); text-decoration: none; }
    .doc-link:hover { text-decoration: underline; }
    .doc-table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 12px; }
    .doc-td { padding: 8px 12px; border: 1px solid var(--border); }
    .doc-table tr:first-child .doc-td { font-weight: 600; background: var(--bg-elevated); color: var(--text-primary); }
    .doc-ul, .doc-ol { margin: 8px 0 12px 20px; font-size: 13px; }
    .doc-li, .doc-li-ordered { margin: 4px 0; }
    strong { color: var(--text-primary); }
  `;
}
