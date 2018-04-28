import { Pipeline, Watcher } from "aemsync";
import browserSync from "browser-sync";
import gfs from "graceful-fs";
import path from "path";
import { ClientlibTree, IClientlibTreeConfig, ILib } from "./clientlib-tree";
import { StyleTree } from "./style-tree";
import { StyleTrees } from "./style-trees";

// TODO maybe don't extend, since hard coupling not needed/wanted?
export interface IWrapperConfig extends IClientlibTreeConfig {
  name: string;
  bsOptions: browserSync.Options;
  jcrContentRoots: string[];
}

// Clientlib stuff, nu support for multiple instances this way
let clientlibTree: ClientlibTree;
let styleTrees: StyleTrees;
let config: IWrapperConfig;

export function create(
  args: IWrapperConfig
): Promise<browserSync.BrowserSyncInstance | void> {
  // Documentation: https://www.browsersync.io/docs/options
  const bsOptions: browserSync.Options = {
    notify: false,
    open: false
  };

  // Assign extra options to bs
  Object.assign(bsOptions, args.bsOptions);
  config = args;
  config.jcrContentRoots = config.jcrContentRoots || ["src/content/jcr_root/"];

  // Setup clientlib stuff
  const sw = Date.now();

  const promises: Array<Promise<any>> = [];
  // TODO provide server data
  // TODO handle unresponsive server(s)
  clientlibTree = new ClientlibTree(config);
  promises.push(clientlibTree.init());

  styleTrees = new StyleTrees(config.jcrContentRoots);
  promises.push(styleTrees.init());
  return Promise.all(promises)
    .then(() => {
      //   console.log(`Init clientlibs finished`);
      console.log(
        "Build style and clientlib trees: " + (Date.now() - sw) + " ms"
      );
      console.log("---------------------------------------");

      // Create bs instance
      const bs = browserSync.create(args.name);
      bs.init(bsOptions, (unknown, data) => {
        // Callback:
        //    console.log(data.options.get("urls").get("ui"));
        //    console.log(data.options.get("urls").get("ui-external"));
        //    console.log(bs.getOption("urls"));
      });
      return bs;
    })
    .catch(reason => {
      console.log(`Init rejected: ${reason}`);
    });
}

export function reload(instanceName: string, inputList: string[]): void {
  // Get current bs based on name
  const bs = browserSync.get(instanceName);

  //  console.log("bs: ", bs);
  let css = false;
  let js = false;
  let html = false;
  let other = false;
  const cssPaths: string[] = [];
  const csstxtPaths: string[] = [];
  const specialPaths: string[] = [];

  inputList.forEach(absolutePath => {
    // console.log('item', item);
    if (absolutePath) {
      if (/\.(css|less|scss)$/.test(absolutePath)) {
        cssPaths.push(absolutePath);
      } else if (/\.(js)$/.test(absolutePath)) {
        js = true;
      } else if (/\.(html|jsp)$/.test(absolutePath)) {
        html = true;
      } else if (/css\.txt$/.test(absolutePath)) {
        csstxtPaths.push(absolutePath);
      } else {
        // In packager special files are turned into dirs (.content.xml for example)
        const stat = gfs.statSync(absolutePath);
        if (stat.isDirectory()) {
          specialPaths.push(absolutePath);
        } else {
          other = true;
        }
      }
    }
  });

  // Fix state
  // css.txt has only effect on one individual client lib, so handle as css/less
  css = css || cssPaths.length > 0 || csstxtPaths.length > 0;
  other = other || specialPaths.length > 0;

  // Always update styling info, since we only
  let sw = Date.now();

  // MULTI STYLE TREES
  const cssRelatedFiles = cssPaths.concat(csstxtPaths);
  const cssExt = ".css";
  const cssToRefresh: string[] = [];
  styleTrees.findClientlibs(cssRelatedFiles).forEach(cssFile => {
    const cssBase = path.join(
      path.dirname(cssFile),
      path.basename(cssFile, cssExt)
    );
    // console.log(`Name without css: ${cssBase}`)
    const clientLibs = clientlibTree.findClientlibs(cssBase);
    clientLibs.forEach(lib => {
      // console.log(`Lib name: ${lib.name} (${lib.css})`);
      if (lib.css && cssToRefresh.indexOf(lib.css) === -1) {
        cssToRefresh.push(lib.css);
      }
    });
  });
  // console.log(cssToRefresh);

  console.log("Determine dependencies: " + (Date.now() - sw) + " ms");

  if (css && !js && !html && !other) {
    console.log("Only styling was changed, try to inject");
    bs.reload(cssToRefresh);
  } else {
    bs.reload();

    if (specialPaths.length > 0) {
      console.log("Special paths were changed, so rebuild clientlib tree");
      // Something changed in the structure, so rebuild all clientlib stuff
      // TODO make function for this

      // // Setup clientlib stuff
      sw = Date.now();
      // TODO reuse objects and only reinit?
      const promises = [];
      clientlibTree = new ClientlibTree(config);
      promises.push(clientlibTree.init());
      // DOn't update style three, since it happened in the prvious step (if there were any less/css/csstxt changes)
      // TODO maybe leave it in, as a catch-all in case we miss something when updating the file tree
      Promise.all(promises)
        .then(() => {
          // console.log(`Init clientlibs finished`);
          console.log("Rebuild clientlib tree: " + (Date.now() - sw) + " ms");
        })
        .catch(reason => {
          console.log(`Rebuild rejected: ${reason}`);
        });
    }
  }
}
