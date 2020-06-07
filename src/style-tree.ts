// var less = require('less');
import lessTree from "@abmaonline/less-tree";
import fs from "fs";
import path from "path";
import recursive from "recursive-readdir";
import treeModel from "tree-model";
// const treeify = require('treeify');

// TODO turn into type?
interface IModel {
  id: string;
  type: string;
  filePath: string;
  isMissing: boolean;
  children: IModel[];
}

export class StyleTree {
  private jcrRootDir: string;
  // TODO maybe init in constructor, but can we return promises from consturctor?
  private rootNode!: treeModel.Node<IModel>; // definite assignment assertion: assigned in init() function
  private tree = new treeModel();

  // use with '/src/content/jcr_root'
  constructor(relativeJcrPath: string) {
    this.jcrRootDir = path.resolve(relativeJcrPath);
  }

  // === Class ===

  public init() {
    // const jcrRootDir = this.jcrRootDir;

    const model: IModel = {
      children: [],
      filePath: "",
      id: "",
      isMissing: false,
      type: "root"
    };

    // Start processing
    const sw = Date.now();

    return new Promise((resolve, reject) => {
      recursive(this.jcrRootDir, (err, files) => {
        console.log("Read file tree: " + (Date.now() - sw) + " ms");

        // Does this work?
        if (err) {
          reject(err);
          return;
        }

        let swInner = Date.now();

        // `files` is an array of absolute file paths
        const rootFilesRegex = /((css|js)\.txt|(\.content\.xml))$/i;
        const contentXmlFilesRelative: string[] = [];
        const jsTxtFilesRelative: string[] = [];
        const cssTxtFilesRelative: string[] = [];
        const otherFilesRelative: string[] = [];

        files.forEach(filePath => {
          // Make relative for jcrRootDir
          const filePathRelative = path.relative(this.jcrRootDir, filePath);
          let match;
          // tslint:disable-next-line:no-conditional-assignment
          if ((match = rootFilesRegex.exec(filePathRelative)) !== null) {
            if (match[3]) {
              contentXmlFilesRelative.push(filePathRelative);
            } else if (match[2] === "css") {
              cssTxtFilesRelative.push(filePathRelative);
            } else if (match[2] === "js") {
              jsTxtFilesRelative.push(filePathRelative);
            } else {
              otherFilesRelative.push(filePathRelative);
            }
          }
        });

        // console.log('time split', (Date.now() - swInner) / 1000);

        swInner = Date.now();

        cssTxtFilesRelative.forEach(cssTxtFileRelative => {
          // Test if css.txt also has a clientlib definition, otherwise skip it
          const contentFileRelative = path.join(
            path.dirname(cssTxtFileRelative),
            ".content.xml"
          );
          if (contentXmlFilesRelative.indexOf(contentFileRelative) === -1) {
            return;
          }

          const cssTxtModel = this.getCssTxtModel(cssTxtFileRelative);
          model.children.push(cssTxtModel);
        });

        // console.log('time css files', (Date.now() - swInner) / 1000);

        swInner = Date.now();

        // Public?
        this.rootNode = this.tree.parse(model);

        // console.log('time tree parse', (Date.now() - swInner) / 1000);
        //    console.log(clientlib);
        console.log("Build style tree: " + (Date.now() - sw) + " ms");
        //   console.log(clientlib.length, content.length, css.length, js.length, other.length);
        // console.log(contentXmlFilesJcr.length, cssTxtFilesJcr.length, jsTxtFilesJcr.length, otherFilesJcr.length);

        resolve();
      });
    });
  }

  public findClientlibs(filePathRelative: string) {
    return this.findClientlibsInternal(this.rootNode, filePathRelative);
  }

  // === Other privates ===

  private getCssTxtModel(cssTxtFileRelative: string): IModel {
    const basePathRelative = path.dirname(cssTxtFileRelative);

    // TODO css.txt is always pulled from the file system, so always present
    // no need to handle new ones here?
    // We probably need a reload on adding css.txt anyway?
    // But how do we detect if a reload is happening and we also need to update our cache?
    // Check if we can see this in browser sync?
    const cssTxtModel: IModel = {
      children: [],
      filePath: cssTxtFileRelative,
      id: cssTxtFileRelative,
      isMissing: false,
      type: "csstxt"
    };

    try {
      // TODO create function that returns array of filenames, maybe make module?
      const contents = fs.readFileSync(
        path.join(this.jcrRootDir, cssTxtFileRelative),
        "utf8"
      );
      const arrayOfLines = contents.match(/[^\r\n]+/g);
      if (arrayOfLines && arrayOfLines.length > 0) {
        let prefix = "";

        arrayOfLines.forEach((line: string) => {
          const baseMatch = /#base=(.*)/.exec(line);
          if (baseMatch !== null) {
            prefix = baseMatch[1];
          } else {
            const sourceLine = line.trim();
            // Check if not commented out
            if (sourceLine.indexOf("//") !== 0) {
              // Test if 'absolute' within jcr:
              // If so, make relative to root (otherwise it will start with X:\ on Windows)
              // Otherwise prefix with relative path for css.txt and base-prefix
              const sourceFileRelative = path.isAbsolute(sourceLine)
                ? path.relative(path.sep, sourceLine)
                : path.join(basePathRelative, prefix, sourceLine);

              const sourceModel = this.getSourceModel(sourceFileRelative);
              cssTxtModel.children.push(sourceModel);
            }
          }
        });
      } else {
        // console.log('empty file', cssTxtFileJcr);
      }
    } catch (err) {
      cssTxtModel.isMissing = true;
    }

    return cssTxtModel;
  }

  private getSourceModel(sourceFileRelative: string): IModel {
    sourceFileRelative = path.normalize(sourceFileRelative);

    const sourceModel: IModel = {
      children: [],
      filePath: sourceFileRelative,
      id: sourceFileRelative,
      isMissing: false,
      type: "source"
    };
    // TODO maybe add stats call to determine missing, but check performance
    // we can also use files list from recursive?

    // TODO also include css imports? But tricky with lessTree, since it always adds .less
    // and css imports are bad practice anyway
    if (path.extname(sourceFileRelative) === ".less") {
      sourceModel.type = "less";
      const newLessTree = this._getLessTree(sourceFileRelative);
      const importModels = this.lessTree2Model(newLessTree);
      // Skip root, since it is current source file
      sourceModel.children = importModels.children;
      sourceModel.isMissing = importModels.isMissing; // TODO still needed here?
    }
    return sourceModel;
  }

  private lessTree2Model(newLessTree: lessTree.LessTree): IModel {
    const filePathRelative = path.relative(this.jcrRootDir, newLessTree.path);

    const model: IModel = {
      children: [],
      filePath: filePathRelative,
      id: filePathRelative,
      isMissing: !newLessTree.contents,
      type: "less-import"
    };

    if (newLessTree.children) {
      newLessTree.children.forEach(child => {
        const childModel = this.lessTree2Model(child);
        model.children.push(childModel);
      });
    }

    return model;
  }

  private findClientlibsInternal(
    rootNode: treeModel.Node<IModel>,
    filePathRelative: string
  ): string[] {
    enum pathIndex {
      root,
      clientlib,
      less,
      import
    }

    const sw = Date.now();
    // Reset cache
    this._getLessTree("", true);
    const clientlibCssPathsRelative: string[] = [];

    const nodes = rootNode.all(
      node => node.model.filePath === filePathRelative
    );
    nodes.forEach(node => {
      // TODO use type for functionality
      const nodePath = node.getPath();
      if (nodePath && nodePath.length > pathIndex.clientlib) {
        const clientlibNode = nodePath[pathIndex.clientlib];
        const clientlibCss =
          path.dirname(clientlibNode.model.filePath) + ".css";
        if (clientlibCssPathsRelative.indexOf(clientlibCss) === -1) {
          clientlibCssPathsRelative.push(clientlibCss);
        }
      }
      if (node.hasChildren() || node.model.isMissing) {
        this.updateClientlibs(rootNode, node);
      }
    });

    // TODO do something for new css.txt?
    if (nodes.length === 0 && path.basename(filePathRelative) === "css.txt") {
      console.log("Missing css.txt, so add", filePathRelative);
      this.updateClientlibs(rootNode, filePathRelative);
    }

    // console.log('time findClientlibs', (Date.now() - sw) / 1000);
    // console.log(clientlibCssPaths);
    return clientlibCssPathsRelative;
  }

  // TODO nicer way of handling new css.txt? It's own function maybe?
  private updateClientlibs(
    rootNode: treeModel.Node<IModel>,
    node: treeModel.Node<IModel> | string
  ): IModel | undefined {
    let newModel;
    if (typeof node === "string") {
      if (path.basename(node) === "css.txt") {
        console.log("updateClientlibs add new csstxt");
        newModel = this.getCssTxtModel(node);
      }
    } else {
      if (["less", "less-import"].indexOf(node.model.type) > -1) {
        // console.log('updateClientlibs less');
        // TODO use cache for models, so we can reuse it if it was imported in
        // multiple files
        // Is cloning needed, would be nasty with children?
        newModel = this.getSourceModel(node.model.filePath);
      } else if (["csstxt"].indexOf(node.model.type) > -1) {
        console.log("updateClientlibs csstxt");
        newModel = this.getCssTxtModel(node.model.filePath);
      }

      // TODO walk newNode and return a list of all updated subs, so we can check for it before
      // processing the next file and prevent double work
      // We probably need the path in the tree for it, since the filename is also used in the
      // other refs
      // Make id's unique and use those?
      // Maybe just update the model and generate tree again? But updating model sucks
      // Or rebuild unique path based on parent chain + id?
      // Ditch id all together, since confusing?
    }

    if (newModel) {
      const newNode = this.tree.parse(newModel);
      if (typeof node === "string") {
        rootNode.addChild(newNode);
      } else {
        const parentNode = node.parent;
        const index = node.getIndex();
        node.drop();
        if (parentNode) {
          parentNode.addChildAtIndex(newNode, index);
        }
      }

      return newModel;
    }
  }

  // FOR TESTING
  private copyFileSync(srcFile: string, destFile: string) {
    let BUF_LENGTH;
    let buff;
    let bytesRead;
    let fdr;
    let fdw;
    let pos;
    BUF_LENGTH = 64 * 1024;
    buff = new Buffer(BUF_LENGTH);
    fdr = fs.openSync(srcFile, "r");
    fdw = fs.openSync(destFile, "w");
    bytesRead = 1;
    pos = 0;
    while (bytesRead > 0) {
      bytesRead = fs.readSync(fdr, buff, 0, BUF_LENGTH, pos);
      fs.writeSync(fdw, buff, 0, bytesRead);
      pos += bytesRead;
    }
    fs.closeSync(fdr);
    return fs.closeSync(fdw);
  }

  // === Private statics ===
  private _getLessTree(
    fileRelative: string,
    resetCache?: boolean
  ): lessTree.LessTree {
    resetCache = !!resetCache; // Cast to explicit boolean
    // TODO make async and paralel
    const tree = lessTree(
      path.join(this.jcrRootDir, fileRelative),
      this.jcrRootDir,
      resetCache
    );
    return tree;
  }
}
