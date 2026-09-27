import QR from 'qrcode/lib/core/qrcode';

/** Pure, offline QR → SVG string (used for printable labels; no network, no WebView scripts). */
export function qrSvg(text: string, size = 200, margin = 2): string {
  const { modules } = QR.create(text, { errorCorrectionLevel: 'M' });
  const n = modules.size;
  const cell = size / (n + margin * 2);
  let path = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (modules.get(r, c)) path += `M${((c + margin) * cell).toFixed(2)} ${((r + margin) * cell).toFixed(2)}h${cell.toFixed(2)}v${cell.toFixed(2)}h-${cell.toFixed(2)}z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="#1D1B18"/></svg>`;
}
