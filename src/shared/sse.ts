export interface SseEvent {
  event: string;
  data: string;
}

export async function* parseSseEvents(stream: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const boundary = buffer.search(/\r?\n\r?\n/);
      if (boundary === -1) break;

      const rawEvent = buffer.slice(0, boundary);
      const match = buffer.slice(boundary).match(/^\r?\n\r?\n/);
      const separatorLength = match?.[0].length ?? 2;
      buffer = buffer.slice(boundary + separatorLength);

      const event = toSseEvent(rawEvent);
      if (event) yield event;
    }
  }

  buffer += decoder.decode();
  const event = toSseEvent(buffer);
  if (event) yield event;
}

function toSseEvent(rawEvent: string): SseEvent | null {
  if (!rawEvent.trim()) return null;

  const lines = rawEvent.split(/\r?\n/);
  let event = "message";
  const dataParts: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataParts.push(line.slice(5).trimStart());
    }
  }

  const data = dataParts.join("\n");
  return data ? { event, data } : null;
}

export function formatSseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`;
}
