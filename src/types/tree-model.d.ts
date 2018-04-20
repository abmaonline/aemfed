export = tree_model;

declare class tree_model<T> {
  constructor(config?: tree_model.Config<T>);
  public parse(model: T): tree_model.Node<T>;
}

declare namespace tree_model {
  export interface Config<T> {
    childrenPropertyName?: string;
    modelComparatorFn?: (elementToCompareWith: T, elementToInsert: T) => number;
  }

  export interface Node<T> {
    config: Config<T>;
    model: T;
    children: Array<Node<T>>;
    parent: Node<T>;
    isRoot(): boolean;
    hasChildren(): boolean;
    addChild(child: Node<T>): Node<T>;
    addChildAtIndex(child: Node<T>, index: number): Node<T>;
    setIndex(index: number): Node<T>;
    getPath(): Array<Node<T>>;
    getIndex(): number;
    // walk, all and first use nasty parseArgs logic...
    walk(callback: (node: Node<T>) => boolean, context?: any): void;
    walk(
      options: WalkOptions,
      callback: (node: Node<T>) => boolean,
      context?: any
    ): void;
    all(callback: (node: Node<T>) => boolean, context?: any): Array<Node<T>>;
    all(
      options: WalkOptions,
      callback: (node: Node<T>) => boolean,
      context?: any
    ): Array<Node<T>>;
    first(
      callback: (node: Node<T>) => boolean,
      context?: any
    ): Node<T> | undefined;
    first(
      options: WalkOptions,
      callback: (node: Node<T>) => boolean,
      context?: any
    ): Node<T> | undefined;
    drop(): Node<T>;
  }

  export enum WalkStrategies {
    PRE = "pre",
    POST = "post",
    BREADTH = "breadth"
  }

  export interface WalkOptions {
    strategy: WalkStrategies;
  }
}
