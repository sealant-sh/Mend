/** Incremental NDJSON line decoder that preserves split UTF-8 code points and partial lines. */
export interface NdjsonDecoder {
  /** Add one arbitrary byte frame and return every complete line it finished. */
  readonly push: (bytes: Uint8Array) => ReadonlyArray<string>;
  /** Whether every received byte belongs to a newline-terminated line. */
  readonly atLineBoundary: () => boolean;
  /** Flush the UTF-8 decoder and return a final unterminated line, when present. */
  readonly finish: () => ReadonlyArray<string>;
}

/** Create a stateful decoder for one stdio output stream. */
export const createNdjsonDecoder = (): NdjsonDecoder => {
  const decoder = new TextDecoder();
  let buffer = "";
  let boundary = true;

  const takeLines = (final: boolean): ReadonlyArray<string> => {
    const lines: string[] = [];
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      if (line !== "") lines.push(line);
    }
    if (final && buffer !== "") {
      lines.push(buffer.replace(/\r$/, ""));
      buffer = "";
    }
    return lines;
  };

  return {
    push: (bytes) => {
      if (bytes.length > 0) boundary = bytes.at(-1) === 0x0a;
      buffer += decoder.decode(bytes, { stream: true });
      return takeLines(false);
    },
    atLineBoundary: () => boundary,
    finish: () => {
      buffer += decoder.decode();
      return takeLines(true);
    },
  };
};
