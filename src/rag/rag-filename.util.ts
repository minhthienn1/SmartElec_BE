const MOJIBAKE_MARKERS = ['Ã', 'Â', 'Ä', 'Æ', 'Ð', 'á»', 'áº', 'á¼', 'á¾', 'á½'];

export function normalizeRagFilename(filename: string) {
  if (!filename) {
    return filename;
  }

  const looksBroken = MOJIBAKE_MARKERS.some((marker) => filename.includes(marker));
  if (!looksBroken) {
    return filename;
  }

  try {
    const decoded = Buffer.from(filename, 'latin1').toString('utf8');
    return decoded || filename;
  } catch {
    return filename;
  }
}
