export function previewDocument(files) {
  const html = files.find(f => f.path === 'index.html');
  if (!html) throw new Error('Preview needs an index.html at the project root. Other languages can be edited but cannot run on iPhone.');
  const get = name => files.find(f => f.path === name.replace(/^\.\//, ''));
  let source = html.content.replace(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/gi, (tag, name) => {
    const file = get(name); return file && name.endsWith('.css') ? `<style>${file.content.replace(/<\/style/gi, '<\\/style')}</style>` : '';
  });
  source = source.replace(/<script\b([^>]*?)src=["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (_tag, before, name, after) => {
    const file = get(name); return file ? `<script ${before} ${after}>${file.content.replace(/<\/script/gi, '<\\/script')}</script>` : '';
  });
  const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'">`;
  // The iframe also has sandbox=allow-scripts, never allow-same-origin.
  return '<!doctype html><html><head>' + policy + '</head><body>' + source + '</body></html>';
}
