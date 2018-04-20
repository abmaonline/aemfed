import * as File from "vinyl";

export = less_tree;

declare function less_tree(
  filePath: string,
  basepath?: string,
  resetCache?: boolean
): less_tree.LessTree;

declare namespace less_tree {
  export interface LessTree extends File {
    children: LessTree[];
    toTreeObject(): TreeObject;
    toTreeString(): string;
  }

  export interface TreeObject {
    [key: string]: TreeObject;
  }
}
