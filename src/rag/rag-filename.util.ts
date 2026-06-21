const MOJIBAKE_MARKERS = [
  'Ã',
  'Â',
  'Ä',
  'Æ',
  'Ð',
  'á»',
  'áº',
  'á¼',
  'á¾',
  'á½',
];

function countMojibakeMarkers(value: string) {
  return MOJIBAKE_MARKERS.reduce(
    (count, marker) => count + (value.includes(marker) ? 1 : 0),
    0,
  );
}

export function normalizeRagFilename(filename: string) {
  if (!filename) {
    return filename;
  }

  const originalScore = countMojibakeMarkers(filename);

  if (originalScore === 0) {
    return filename;
  }

  try {
    const decoded = Buffer.from(filename, 'latin1').toString('utf8');
    const decodedScore = countMojibakeMarkers(decoded);

    // Chỉ nhận bản decode nếu nó thật sự sạch hơn.
    if (decoded && decodedScore < originalScore) {
      return decoded;
    }

    return filename;
  } catch {
    return filename;
  }
}