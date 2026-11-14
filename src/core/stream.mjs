// Incremental SSE decoder: handles split UTF-8 characters, CRLF, and multiline data.
export function createEventDecoder(onEvent) {
  const decoder = new TextDecoder();
  let buffer = '';
  const consume = () => {
    buffer = buffer.replace(/\r\n/g, '\n');
    let end;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const event = buffer.slice(0, end); buffer = buffer.slice(end + 2);
      const data = event.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).replace(/^ /, '')).join('\n');
      if (data) onEvent(data);
    }
  };
  return { push(chunk) { buffer += decoder.decode(chunk, { stream: true }); consume(); }, finish() { buffer += decoder.decode() + '\n\n'; consume(); } };
}
