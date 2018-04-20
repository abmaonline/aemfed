export declare class Pusher {
  constructor(
    targets: string[],
    interval: number,
    onPushEnd: (err: string, host: string, items: Pusher.PusherItem[]) => void
  );
  public enqueue(localPath: string): void;
  public getItem(localPath: string): Pusher.PusherItem;
  // TODO return type of callback maybe any?
  public onSave(packagePath: string, callback: () => void): void;
  public processQueue(): void;
  public start(): void;
}

export declare class Watcher {
  constructor();
  // Note: workingDirs was workingDir and so string[] is new
  public watch(
    workingDirs: string | string[],
    exclude: string,
    callback: (localPath: string) => void
  ): void;
}

export function main(): void;

declare namespace Pusher {
  export interface PusherItem {
    localPath: string;
    isDirectory: boolean;
    exists: boolean;
    zipPath?: string;
    filterPath?: string;
  }
}
