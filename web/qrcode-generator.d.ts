declare module 'qrcode-generator' {
  interface QRCode {
    addData(data: string): void
    make(): void
    createSvgTag(opts?: { cellSize?: number; margin?: number; scalable?: boolean }): string
  }
  /** typeNumber 0 = auto-size; errorCorrection 'L' | 'M' | 'Q' | 'H' */
  function qrcode(typeNumber: number, errorCorrectionLevel: 'L' | 'M' | 'Q' | 'H'): QRCode
  export default qrcode
}
