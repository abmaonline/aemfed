// var less = require('less');
import fs from "fs";
import lessTree from "less-tree";
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
  private tree = new treeModel<IModel>();

  // use with '/src/content/jcr_root'
  constructor(relativeJcrPath: string) {
    this.jcrRootDir = path.resolve(relativeJcrPath);
  }

  // === Class ===

  public init() {
    // const jcrRootDir = this.jcrRootDir;

    const model: IModel = {
      children: [],
      filePath: path.sep,
      id: path.sep,
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
        const contentXmlFilesJcr: string[] = [];
        const jsTxtFilesJcr: string[] = [];
        const cssTxtFilesJcr: string[] = [];
        const otherFilesJcr: string[] = [];

        files.forEach(filePath => {
          // Make relative for jcrRootDir, but add / so it is absolute within aem
          const filePathJcr = path.join(
            path.sep,
            path.relative(this.jcrRootDir, filePath)
          );
          let match;
          // tslint:disable-next-line:no-conditional-assignment
          if ((match = rootFilesRegex.exec(filePathJcr)) !== null) {
            if (match[3]) {
              contentXmlFilesJcr.push(filePathJcr);
            } else if (match[2] === "css") {
              cssTxtFilesJcr.push(filePathJcr);
            } else if (match[2] === "js") {
              jsTxtFilesJcr.push(filePathJcr);
            } else {
              otherFilesJcr.push(filePathJcr);
            }
          }
        });

        // console.log('time split', (Date.now() - swInner) / 1000);

        swInner = Date.now();

        cssTxtFilesJcr.forEach(cssTxtFileJcr => {
          // Test if css.txt also has a clientlib definition, otherwise skip it
          const contentFileJcr = path.join(
            path.dirname(cssTxtFileJcr),
            ".content.xml"
          );
          if (contentXmlFilesJcr.indexOf(contentFileJcr) === -1) {
            return;
          }

          const cssTxtModel = this.getCssTxtModel(cssTxtFileJcr);
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

  public findClientlibs(filePathJcr: string) {
    return this.findClientlibsInternal(this.rootNode, filePathJcr);
  }

  // === Other privates ===

  private getCssTxtModel(cssTxtFileJcr: string): IModel {
    const basePathJcr = path.dirname(cssTxtFileJcr);

    // TODO css.txt is always pulled from the file system, so always present
    // no need to handle new ones here?
    // We probably need a reload on adding css.txt anyway?
    // But how do we detect if a reload is happening and we also need to update our cache?
    // Check if we can see this in browser sync?
    const cssTxtModel: IModel = {
      children: [],
      filePath: cssTxtFileJcr,
      id: cssTxtFileJcr,
      isMissing: false,
      type: "csstxt"
    };

    try {
      // TODO create function that returns array of filenames, maybe make module?
      const contents = fs.readFileSync(
        path.join(this.jcrRootDir, cssTxtFileJcr),
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
              // Test if 'absolute'
              const sourceFileJcr = path.isAbsolute(sourceLine)
                ? sourceLine
                : path.join(basePathJcr, prefix, sourceLine);

              const sourceModel = this.getSourceModel(sourceFileJcr);
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

  private getSourceModel(sourceFileJcr: string): IModel {
    sourceFileJcr = path.normalize(sourceFileJcr);

    const sourceModel: IModel = {
      children: [],
      filePath: sourceFileJcr,
      id: sourceFileJcr,
      isMissing: false,
      type: "source"
    };
    // TODO maybe add stats call to determine missing, but check performance
    // we can also use files list from recursive?

    // TODO also include css imports? But tricky with lessTree, since it always adds .less
    // and css imports are bad practice anyway
    if (path.extname(sourceFileJcr) === ".less") {
      sourceModel.type = "less";
      const newLessTree = this._getLessTree(sourceFileJcr);
      const importModels = this.lessTree2Model(newLessTree);
      // Skip root, since it is current source file
      sourceModel.children = importModels.children;
      sourceModel.isMissing = importModels.isMissing; // TODO still needed here?
    }
    return sourceModel;
  }

  private lessTree2Model(newLessTree: lessTree.LessTree): IModel {
    const filePathJcr = path.join(
      path.sep,
      path.relative(this.jcrRootDir, newLessTree.path)
    );

    const model: IModel = {
      children: [],
      filePath: filePathJcr,
      id: filePathJcr,
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
    filePathJcr: string
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
    const clientlibCssPaths: string[] = [];

    const nodes = rootNode.all(node => node.model.id === filePathJcr);
    nodes.forEach(node => {
      // TODO use type for functionality
      const nodePath = node.getPath();
      if (nodePath && nodePath.length > pathIndex.clientlib) {
        const clientlibNode = nodePath[pathIndex.clientlib];
        const clientlibCss = path.dirname(clientlibNode.model.id) + ".css";
        if (clientlibCssPaths.indexOf(clientlibCss) === -1) {
          clientlibCssPaths.push(clientlibCss);
        }
      }
      if (node.hasChildren() || node.model.isMissing) {
        this.updateClientlibs(rootNode, node);
      }
    });

    // TODO do something for new css.txt?
    if (nodes.length === 0 && path.basename(filePathJcr) === "css.txt") {
      console.log("Missing css.txt, so add", filePathJcr);
      this.updateClientlibs(rootNode, filePathJcr);
    }

    // console.log('time findClientlibs', (Date.now() - sw) / 1000);
    // console.log(clientlibCssPaths);
    return clientlibCssPaths;
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
        newModel = this.getSourceModel(node.model.id);
      } else if (["csstxt"].indexOf(node.model.type) > -1) {
        console.log("updateClientlibs csstxt");
        newModel = this.getCssTxtModel(node.model.id);
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
        parentNode.addChildAtIndex(newNode, index);
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
  private _getLessTree(file: string, resetCache?: boolean): lessTree.LessTree {
    resetCache = !!resetCache; // Cast to explicit boolean
    // TODO make async and paralel
    const tree = lessTree(
      path.join(this.jcrRootDir, file),
      this.jcrRootDir,
      resetCache
    );
    return tree;
  }
}
