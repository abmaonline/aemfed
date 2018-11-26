// TODO use namespace
interface QrcodeOptions {
  small: boolean;
}

interface QrcodeTerminal {
  error: number; // default error value
  generate(input: string): void;
  generate(input: string, opts: QrcodeOptions): void;
  generate(input: string, cb: (qrcode: string) => void): void;
  generate(
    input: string,
    opts: QrcodeOptions,
    cb: (qrcode: string) => void
  ): void;
  setErrorLevel(error: "M" | "L" | "H" | "Q"): void;
}

declare const qrcodeTerminal: QrcodeTerminal;

// Also add to Window, otherwise it throws errors when not available
interface Window {
  qrcodeTerminal?: QrcodeTerminal;
}
