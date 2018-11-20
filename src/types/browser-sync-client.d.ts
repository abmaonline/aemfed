// import browserSync from "browser-sync";

interface AddData {
  id: string;
  src: string;
}

interface addDomNodeData {
  tagName: string;
  attrs: any[];
  placement?: string;
}

interface Urls {
  local: string;
  external: string;
}

// TODO use namespace
interface BrowserSyncOptions {
  plugins: Map<string, any>[];
  urls: Urls;
}

// Import from something else...
// Has a lot more options and seems to extend something else
interface Socket {
  on: (type: string, callback: (data: any) => void) => void;
}

interface SocketConfig {
  hostname: string;
  path: string;
  port: number;
  reconnectionAttempts: number;
  secure: boolean;
}

interface BrowserSyncClient {
  addCss: (data: AddData) => void;
  addJs: (data: AddData) => void;
  addDomNode: (data: addDomNodeData) => HTMLElement;
  options: BrowserSyncOptions; //browserSync.Options but tricky to import
  socket: Socket;
  socketConfig: SocketConfig;
  socketUrl: string;
}

declare const ___browserSync___: BrowserSyncClient;

// Also add to Window, otherwise it throws errors when not available
interface Window {
  ___browserSync___?: BrowserSyncClient;
}
