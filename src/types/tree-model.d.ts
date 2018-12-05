import { Node } from "tree-model";

// Extend Node<T> typings with strong types for properties
declare module "tree-model" {
  interface Node<T> {
    model: T;
    parent?: Node<T>;
  }
}
// Since VS Code somehow determines the Node import is not used, it is removed, breaking the types.
// This stub maintains the hard reference.
type __stub__ = Node<object>;
