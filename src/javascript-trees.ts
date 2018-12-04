import chalk from "chalk";
import rpn from "request-promise-native";
import { ClientlibTree, IClientlibTreeConfig } from "./clientlib-tree";
import { normalisePath } from "./utils";

interface IJsLibs extends Map<string, string[]> {
  // We only need to specify the types for the map
}

interface IJsFiles extends Map<string, IJsFile> {
  // We only need to specify the types for the map
}

interface IJsFile {
  path: string;
  lines: number;
}

export interface IMappedFile {
  path: string;
  line: number;
}

export class JavascriptTrees {
  private name: string;
  private server: string;
  private libs: IJsLibs = new Map();
  private files: IJsFiles = new Map();
  private proxies: Map<string, string | undefined> = new Map();
  private clientlibTree: ClientlibTree;

  constructor(config: IClientlibTreeConfig, clientlibTree: ClientlibTree) {
    // TODO get default name from server/target, using util?
    config = config || {
      name: "localhost:4502",
      server: "http://admin:admin@localhost:4502"
    };
    this.server = config.server;
    this.name = config.name;
    this.clientlibTree = clientlibTree;
  }

  /**
   * For a provided javascript client lib sanitize its url and try to get all included files and their line nrs
   * @param jsLib Name of javascript client lib as provided in html include or http call
   * @returns Promise when lib and files are ready
   */
  public addLibAndFiles(jsLib: string): Promise<void> {
    const sanitizedUrl = this.sanitizeJsLibUrl(jsLib);

    if (!sanitizedUrl) {
      // Reject when invalid url
      return Promise.reject(`Could not sanitize '${jsLib}', so don't process`);
    }
    const sw = Date.now();
    let swInner = Date.now();

    return this.addLib(sanitizedUrl)
      .then(jsFileNames => {
        // Lib was added (or already in cache), start checking the files in it
        // Trigger updating of file lengths
        swInner = Date.now();
        return this.updateJsFileLengths(jsFileNames);
      })
      .then(updatedJsFileObjects => {
        // Place for logging
      })
      .catch(err => {
        console.error(`Error: ${err}`);
      });
  }

  /**
   * Provided a concatenated javascript client lib and line number in it, returns an object with the path and relative line nr of the individual file in it (a bit like a source map). Also checks if needed libs and files are present and gets them if needed.
   * @param jsLibPath Javascript library as included in html, url will be sanitized and looked up in libs Map
   * @param lineNr Line nr mentioned in relation to concatenated javascript file for lib
   * @returns Object with JCR path and relative line nr for individual file as included in jsLibPath
   */
  public getMappedFile(
    jsLibPath: string,
    lineNr: number
  ): Promise<IMappedFile | void> {
    // Make sure we have all data needed first
    return this.addLibAndFiles(jsLibPath).then(() => {
      const jsLibFilePaths = this.libs.get(jsLibPath);
      if (jsLibFilePaths) {
        let lineCounter = 0;
        for (const jsFilePath of jsLibFilePaths) {
          const jsFile = this.files.get(jsFilePath);
          if (jsFile) {
            const end = lineCounter + jsFile.lines;
            // lineNr is one based
            if (lineNr > lineCounter && lineNr <= end) {
              return {
                line: lineNr - lineCounter,
                path: jsFile.path
              };
            } else {
              // Not our file, update counter
              lineCounter = end;
            }
          } else {
            console.error(
              chalk`[{red ERROR}] File not found when mapping '${jsLibPath}': ${jsFilePath}`
            );
          }
        }
      }
    });
  }

  /**
   * Empty Map with javascript files or only provided files when list is provided (but not the Map with libs and their includes, use resetLibs() for that)
   */
  public resetFiles(filePaths?: string[]) {
    if (filePaths) {
      filePaths.forEach(filePath => this.files.delete(normalisePath(filePath)));
    } else {
      this.files.clear();
    }
  }

  /**
   * Empty Map with javascript libs (but not the Map with files and their line numbers, use resetFiles() for that)
   */
  public resetLibs() {
    this.libs.clear();
  }

  private addLib(sanitizedUrl: string): Promise<string[]> {
    let jsFileNames = this.libs.get(sanitizedUrl);
    if (jsFileNames) {
      return Promise.resolve(jsFileNames);
    }

    // === Not cached, so start processing ===
    let sw = Date.now();

    // Adding debug=true to javascript client lib request, adds all seperate javascript
    // file names in a piece of wrapper javascript, which we can use to extract the
    // file names and their order in the combined client lib file (it's a bit like the
    // include files for the css files)
    const debugPostFix =
      (sanitizedUrl.indexOf("?") > -1 ? "&" : "?") + "debug=true";

    return rpn(this.server + sanitizedUrl + debugPostFix).then((js: string) => {
      sw = Date.now();
      jsFileNames = this.processJsRegex(js);
      // TODO only set jsFileNames after we updateJsFileLengths below?
      this.libs.set(sanitizedUrl, jsFileNames);

      return jsFileNames;
    });
  }

  /**
   * Update the files Map with line nrs for the provided JCR javascript file names
   * @param jsFileJcrPaths Array with JCR javascript files to check line nrs for and store in files Map
   * @param force When true force an update on the files (for exmaple in case it was changed)
   */
  private updateJsFileLengths(
    jsFileJcrPaths: string[],
    force: boolean = false
  ): Promise<IJsFile[]> {
    const promises = jsFileJcrPaths.map(jsFileName => {
      return this.updateJsFileLength(jsFileName, force);
    });

    return Promise.all(promises).then(updatedJsFiles => {
      return updatedJsFiles.filter(
        (file): file is IJsFile => typeof file !== "undefined"
      );
    });
  }

  /**
   * Get and update the number of lines for the provided file in the files Map
   * @param jsFileJcrPath Path in JCR of javascript file
   * @param force When true force an update on the file (for example in case it was changed)
   * @returns Promise with a IJsFile if file was found or void when already in cache
   */
  private updateJsFileLength(
    jsFileJcrPath: string,
    force: boolean = false
  ): Promise<IJsFile | void> {
    // If forced, remove current entry
    if (force) {
      this.files.delete(jsFileJcrPath);
    }

    // Test if missing
    if (!this.files.has(jsFileJcrPath)) {
      // Disable minification for correct number of lines
      const debugPostFix =
        (jsFileJcrPath.indexOf("?") > -1 ? "&" : "?") + "debug=true";

      // Get javascript from jcr
      return rpn(this.server + jsFileJcrPath + debugPostFix)
        .then((js: string) => {
          const lines = js.split(/[\n\u0085\u2028\u2029]|\r\n?/);
          return lines.length;
        })
        .catch(err => {
          console.error(
            `Error when getting ${jsFileJcrPath}: ${err} (add file with 0 lines)`
          );
          // Error? Return 0 lines
          return 0;
        })
        .then((lines: number) => {
          const jsFile: IJsFile = {
            lines,
            path: jsFileJcrPath
          };
          this.files.set(jsFileJcrPath, jsFile);
          return jsFile;
        });
    } else {
      // Already in cache, return nothing (to detect only updates)
      return Promise.resolve();
    }
  }

  private sanitizeJsLibUrl(jsLib: string) {
    const match = /^(\/.*?)(\.min)?(\.[0-9a-f]{32})?(\.js)(\?.*?)?$/.exec(
      jsLib
    );
    if (match) {
      const baseName = match[1];
      const extension = match[4];
      // Try to translate /etc.clientlibs/ back to actual path
      // findProxyTarget doesn't expect (or returns) an extension for now
      const target = this.clientlibTree.findProxyTarget(baseName);
      if (target) {
        // A target was found, so return result
        return target + extension;
      } else {
        console.error("sanitizeJsLibUrl no target was found for", baseName);
      }
    }
  }

  private processJsRegex(body: string) {
    const blockRegex = /Loader\.js *= *\[([\s\S]*?)\];/gim;
    const lineRegex = /"(.*?)"/gi;
    const jsFileJcrPaths: string[] = [];

    const blockMatches = this.getMatches(blockRegex, body);
    // There is only one block
    const blockMatch = blockMatches[0];
    if (blockMatch) {
      const blockContent = blockMatch[1];
      const jsFileMatches = this.getMatches(lineRegex, blockContent);
      jsFileMatches.forEach(jsFileMatch => {
        jsFileJcrPaths.push(jsFileMatch[1]);
      });
    }
    return jsFileJcrPaths;
  }

  // From clientlib-tree
  private getMatches(regex: RegExp, str: string) {
    let m;
    const result = [];

    // tslint:disable-next-line:no-conditional-assignment
    while ((m = regex.exec(str)) !== null) {
      // This is necessary to avoid infinite loops with zero-width matches
      if (m.index === regex.lastIndex) {
        regex.lastIndex++;
      }
      result.push(m);
    }
    return result;
  }
}
