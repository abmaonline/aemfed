// Used to read json files using 'import data from "./data.json"' pattern
declare module "*.json" {
  const value: any;
  export default value;
}

// node.d.ts for 6.14 doesn't contain the PathLike type, needed by graceful-fs.d.ts
// Remove again when upgrading to node 8.x d.ts, but it looks like it will use fs.PathLike
// when it is present (at least when transpiling from the commandline)
type PathLike = string | Buffer;

// Client types
type printQrCode = () => void;

// Also add to Window, otherwise it throws errors when not available
interface Window {
  qr?: printQrCode;
}
interface BrowserSyncClient {
  qr?: printQrCode;
}

declare namespace BsQrCode {
  interface IOptions {
    onload: boolean;
  }
}
