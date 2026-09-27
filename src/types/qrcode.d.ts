declare module 'qrcode/lib/core/qrcode' {
  interface QRSymbol {
    modules: { size: number; data: Uint8Array | boolean[]; get(row: number, col: number): boolean | number };
  }
  const QR: { create(text: string, opts?: { errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H' }): QRSymbol };
  export default QR;
}
