const MOJIBAKE_MARKERS = [
  'Ã',
  'Â',
  'Ä',
  'Å',
  'Æ',
  'Ð',
  'Ñ',
  'ÃƒÆ’',
  'Ãƒâ€š',
  'Ãƒâ€ž',
  'Ãƒâ€ ',
  'ÃƒÂ',
  'ÃƒÂ¡Ã‚Â»',
  'ÃƒÂ¡Ã‚Âº',
  'ÃƒÂ¡Ã‚Â¼',
  'ÃƒÂ¡Ã‚Â¾',
  'ÃƒÂ¡Ã‚Â½',
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

    // Chỉ nhận bản decode nếu nó thực sự sạch hơn.
    if (decoded && decodedScore < originalScore) {
      return decoded;
    }

    return filename;
  } catch {
    return filename;
  }
}

export function hasInvalidRagFilename(filename: string) {
  return /[\u0000-\u001f\u007f]/.test(filename);
}
