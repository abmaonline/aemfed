import path from "path";
import { StyleTree } from "./style-tree";

export class StyleTrees {
  private relativeJcrPaths: string[];
  // TODO convert to type?
  private styleTrees: { [key: string]: StyleTree };

  constructor(relativeJcrPaths: string[]) {
    this.relativeJcrPaths = relativeJcrPaths;
    this.styleTrees = {};
  }

  public init(): Promise<void[]> {
    // for each dir, create styleTree and call init
    // uses promises, so return all()
    // stored in map using path => styleTree?
    const promises: Array<Promise<void>> = [];
    // TODO convert to map()
    this.relativeJcrPaths.forEach(jcrPath => {
      // Path can be relative or absolute, so convert always to absolute
      const absolutePath = path.resolve(jcrPath);
      const styleTree = new StyleTree(absolutePath);
      promises.push(
        styleTree.init().then(() => {
          this.styleTrees[absolutePath] = styleTree;
        })
      );
    });

    return Promise.all(promises);
  }

  public findClientlibs(absoluteFilePaths: string[]) {
    // also need the source path before we can start looking?
    // use path to select correct styleTree from map
    const clientlibCssPaths: string[] = [];

    // get all root paths
    // check if starts with one of them
    // process with correct styleTree
    const rootDirs = Object.keys(this.styleTrees);
    absoluteFilePaths.forEach(filePath => {
      rootDirs.forEach(rootDir => {
        if (filePath.indexOf(rootDir) === 0) {
          // Found correct styleTree
          const styleTree = this.styleTrees[rootDir];
          const relativeJcrPath = filePath.replace(rootDir, "");
          const relatedClientlibCss = styleTree.findClientlibs(relativeJcrPath);
          // Test if found clientlibs are already in result set, if not: add
          relatedClientlibCss.forEach(clientlib => {
            if (clientlibCssPaths.indexOf(clientlib) === -1) {
              clientlibCssPaths.push(clientlib);
            }
          });
        }
      });
    });

    return clientlibCssPaths;
  }
}

// module.exports.StyleTrees = StyleTrees
