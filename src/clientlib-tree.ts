import chalk from "chalk";
import rpn from "request-promise-native";
import { JavascriptTrees } from "./javascript-trees";
// const syncRequest = require('sync-request');

// html source document
// contains css links
// find out which client libs belong to it, so we can get those from test1
// embed
// dependencies

// TODO fix class?
// TODO fix optionals?
export interface ILib {
  name: string;
  js?: string;
  css?: string;
  theme?: string;
  categories: string[];
  channels: string[];
  dependencies: string[];
  embedded: string[];
}

interface ILibs extends Map<string, ILib> {
  // Only used for map types
}

// TODO does this need fixing? Other location/structure?
interface ILink {
  href: string;
  text: string;
}

export interface IClientlibTreeConfig {
  name: string;
  server: string;
  dumpLibsPath?: string;
}

export class ClientlibTree {
  public jsTrees: JavascriptTrees;
  private name: string;
  private server: string;
  private path: string;
  private libs: ILibs;

  constructor(config?: IClientlibTreeConfig) {
    // TODO get default name from server/target, using util?
    config = config || {
      name: "localhost:4502",
      server: "http://admin:admin@localhost:4502"
    };
    this.name = config.name;
    this.server = config.server;
    this.path = config.dumpLibsPath || "/libs/granite/ui/content/dumplibs.html";
    this.libs = new Map();
    this.jsTrees = new JavascriptTrees(config, this);
  }

  public init() {
    const sw = Date.now();

    let swInner = Date.now();
    return rpn(this.server + this.path).then((html: string) => {
      console.log(
        chalk`[{blue ${this.name}}] Get data from server: ${(
          Date.now() - swInner
        ).toString()} ms`
      );

      swInner = Date.now();
      this.libs = this.processHtmlRegex(html);
      console.log(
        chalk`[{blue ${this.name}}] Process data: ${(
          Date.now() - swInner
        ).toString()} ms`
      );

      console.log(
        chalk`[{blue ${this.name}}] Clientlib tree: ${(
          Date.now() - sw
        ).toString()} ms`
      );
      // console.log('clientlibs:', Object.keys(this.libs).length);
    });

    // var body = getClientlibData();
    // console.log('Get data from server: '+(Date.now() - swInner)+' ms');

    // var swInner = Date.now();
    // this.libs = processHtmlRegex(body);
    // console.log('Process data: '+(Date.now() - swInner)+' ms');

    // console.log('Clientlib tree: '+(Date.now() - sw)+' ms');
    // // console.log('clientlibs:', Object.keys(this.libs).length);
    // if (cb) {
    //     cb.call();
    // }
  }

  // ClientlibTree.prototype.init = function() {
  //     var that = this;
  //     // var promise = new Promise((resolve, reject) => {
  //     var promise = new Promise((resolve, reject) => {
  //         timers.setTimeout(() => { that.initSync(resolve) }, 0);
  //     });
  //     return promise;
  // }

  public findClientlibs(path: string): ILib[] {
    // path is w/o extension for now
    // Embedding works for only one level (at least in 6_1), so no recursion needed
    const result: ILib[] = [];
    for (const [key, lib] of this.libs) {
      // Add lib itself
      if (lib.name === path) {
        // console.log(`Add lib itself`);
        result.push(lib);
      }
      // Add if it is embedded in lib
      if (lib.embedded.indexOf(path) > -1) {
        // console.log(lib);
        result.push(lib);
      }
    }
    return result;
  }

  /**
   * Try to find the proxy target for a proxied client lib (starts with /etc/clientlibs/), but also works for non proxied libs
   * @param path Path to clientlib without extension
   */
  public findProxyTarget(path: string): string | undefined {
    // TODO allow extension and check with lib.js or lib.css?
    const proxyPaths = ["/apps/", "/etc/", "/libs/"]; // TODO get from HTML Lib config?
    const match = /^(\/etc\.clientlibs\/)(.*)/.exec(path);
    const paths = match ? proxyPaths.map(prefix => prefix + match[2]) : [path];
    for (const libPath of paths) {
      const lib = this.libs.get(libPath);
      if (lib) {
        return libPath; // Return works since we use a for, not a forEach with function
      }
    }
    return;
  }

  // === Private statics

  // function getClientlibData() {
  //     var url = '/libs/granite/ui/content/dumplibs.html';
  //     var fullHref = 'http://admin:admin@localhost:4503' + url;
  //     // var response = syncRequest('GET', fullHref);
  //     // var body = response.getBody('utf8');
  //     // // console.log(body);
  //     // return body;
  //     return rpn(fullHref);
  // }

  private processHtmlRegex(body: string): ILibs {
    const tableRegex = /<table>([\s\S]*?)<\/table>/gim;
    const rowRegex = /<tr>([\s\S]*?)<\/tr>/gim;
    const libs: ILibs = new Map();

    const tables = this.getMatches(tableRegex, body);
    // We only need first table for now
    const tableMatch = tables[0];
    if (tableMatch) {
      const tableContent = tableMatch[1];
      const rows = this.getMatches(rowRegex, tableContent);
      rows.forEach(rowM => {
        const lib = this.processRowRegex(rowM[1]);
        if (lib && lib.name) {
          libs.set(lib.name, lib);
        }
      });
    }
    return libs;
  }

  private processRowRegex(row: string): ILib | undefined {
    const cellRegex = /<td>([\s\S]*?)<\/td>/gim;
    enum cellIndex {
      name,
      types,
      categories,
      theme,
      channels,
      dependencies,
      embedded
    }

    const cells = this.getMatches(cellRegex, row);
    const expectedCellsLength = cellIndex.embedded + 1; // There is no reliable way to get the number of values in an enum
    // Check if correct number of columns
    if (cells.length === expectedCellsLength) {
      // Clientlib name
      const names = this.getLinkList(cells[cellIndex.name]);
      if (names.length) {
        const name = names[0].text;
        const lib: ILib = {
          categories: [],
          channels: [],
          dependencies: [],
          embedded: [],
          name
        };

        // Types
        const types = this.getLinkList(cells[cellIndex.types]);
        types.forEach(type => {
          if (type.text === "JS") {
            lib.js = type.href;
          } else if (type.text === "CSS") {
            lib.css = type.href;
          } else {
            console.log(this.name + ": UNKNOWN TYPE: " + type.text);
          }
        });

        // Channels
        lib.categories = this.getLinkList(cells[cellIndex.categories]).map(
          link => link.text
        );

        // Theme
        const themeM = cells[cellIndex.theme];
        if (themeM) {
          lib.theme = themeM[1];
        }

        // Channels
        lib.channels = this.getLinkList(cells[cellIndex.channels]).map(
          link => link.text
        );
        // Dependencies
        lib.dependencies = this.getLinkList(cells[cellIndex.dependencies]).map(
          link => link.text
        );
        // Embedded
        lib.embedded = this.getLinkList(cells[cellIndex.embedded]).map(
          link => link.text
        );

        return lib;
      } else {
        // Row w/o a name?
        console.log(this.name + ": Row w/o a name: " + row);
      }
    } else {
      // Mismatch for columns, should only be in case of table header
    }
  }

  private getLinkList(match: RegExpMatchArray) {
    const index = {
      all: 0,
      href: 1,
      text: 2
    };
    const result: ILink[] = [];

    const links = this.getLinksRegex(match[1]);
    links.forEach(linkM => {
      result.push({
        href: linkM[index.href],
        text: linkM[index.text]
      });
    });

    return result;
  }

  private getLinksRegex(cellContent: string) {
    const anchorRegex = /<a ?[\s\S]*?href=["'](.*?)["'][\s\S]*?>([\s\S]*?)<\/a>/gim;
    return this.getMatches(anchorRegex, cellContent);
  }

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
