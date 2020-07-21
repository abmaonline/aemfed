export declare class Pipeline {
  constructor(args: Pipeline.Args);
  public enqueue(localPath: string): void;
  public process(
    list: Pipeline.PackItem[],
    callback: (err: string) => void
  ): void;
  public processQueue(): void;
  public push(localPath: string): void;
  public start(): void;
}

export declare class Watcher {
  constructor();
  // Note: workingDirs was workingDir and so string[] is new
  public watch(args: Watcher.Args): void;
}

export function main(): void;
export function push(args: Pipeline.Args): void;
// export function aemsync(): void;

declare namespace Pipeline {
  export interface Args {
    targets: string[];
    interval: number;
    packmgrPath?: string;
    onPushEnd: (
      err: string,
      host: string,
      inputList: string[],
      packItems: Pipeline.PackItem[]
    ) => void;
  }
  export interface PackItem {
    localPath: string;
    isDirectory: boolean;
    exists: boolean;
    zipPath?: string;
    filterPath?: string;
  }
}

declare namespace Watcher {
  export interface Args {
    workingDirs: string | string[];
    exclude: string;
    callback: (localPath: string) => void;
  }
}
