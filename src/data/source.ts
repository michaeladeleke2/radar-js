/** What the load functions accept: a File (from <input type="file">), a Blob, or bytes. */
export type Source = Blob | ArrayBuffer | ArrayBufferView;

/** The bytes of a source, as an ArrayBuffer of its own. */
export async function readBytes(source: Source): Promise<ArrayBuffer> {
  if (source instanceof ArrayBuffer) return source;
  if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) as ArrayBuffer;
  return source.arrayBuffer();
}

/** The text of a source (UTF-8). */
export async function readText(source: Source | string): Promise<string> {
  if (typeof source === 'string') return source;
  if (source instanceof Blob) return source.text();
  return new TextDecoder().decode(await readBytes(source));
}
