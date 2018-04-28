import { Pipeline, Watcher } from "aemsync";
import browserSync from "browser-sync";
import gfs from "graceful-fs";
import path from "path";
import { ClientlibTree, IClientlibTreeConfig, ILib } from "./clientlib-tree";
import { StyleTree } from "./style-tree";
import { StyleTrees } from "./style-trees";

export interface IWrapperConfig {
  bsOptions: browserSync.Options;
  jcrContentRoots: string[];
  servers: string[];
  dumpLibsPath?: string;
}

interface Instance {
  clientlibTree: ClientlibTree;
  name: string;
  online: boolean;
  port: number;
  server: string;
}

const instances: { [key: string]: Instance } = {};
const port = 3000; // TODO make configurable

let styleTrees: StyleTrees;
let config: IWrapperConfig;

export function create(args: IWrapperConfig): Promise<void> {
  // Documentation: https://www.browsersync.io/docs/options
  const bsOptions: browserSync.Options = {
    notify: false,
    open: false
  };

  // Assign extra options to bs
  Object.assign(bsOptions, args.bsOptions);
  config = args;
  config.jcrContentRoots = config.jcrContentRoots || ["src/content/jcr_root/"];

  // Generate instances
  args.servers.forEach((server, index) => {
    // host as returned by aemsync onPushEnd
    const host = server.substring(server.indexOf("@") + 1);
    const name = host;
    // TODO check if server is online? Or poll in between and
    const instance: Instance = {
      clientlibTree: new ClientlibTree({ name, server }),
      name,
      online: true,
      port: port + index * 2, // Claim numbers for proxy and ui
      server
    };
    instances[host] = instance;
  });

  // Setup clientlib stuff
  const sw = Date.now();

  const promises: Array<Promise<any>> = [];
  // TODO handle unresponsive server(s)
  const hosts = Object.keys(instances);
  hosts.forEach(host => {
    const instance = instances[host];
    promises.push(instance.clientlibTree.init());
  });

  styleTrees = new StyleTrees(config.jcrContentRoots);
  promises.push(styleTrees.init());
  return Promise.all(promises)
    .then(() => {
      //   console.log(`Init clientlibs finished`);
      console.log(
        "Build style and clientlib trees: " + (Date.now() - sw) + " ms"
      );
      console.log("---------------------------------------");

      // Chain creation promises
      let promise = Promise.resolve();
      hosts.forEach(host => {
        const instance = instances[host];
        // Create bs instance and add to promise chain to make it serial
        promise = promise.then(() => {
          createBsInstancePromise(instance, bsOptions);
        });
      });
      return promise;
    })
    .catch(reason => {
      console.log(`Init rejected: ${reason}`);
    });
}

function createBsInstancePromise(
  instance: Instance,
  bsOptions: browserSync.Options
): Promise<void> {
  return new Promise((resolve, reject) => {
    const bs = browserSync.create(instance.name);
    // Set server specific settings
    // TODO clone options first?
    bsOptions.proxy = { target: instance.server };
    bsOptions.port = instance.port;
    bsOptions.ui = {
      port: instance.port + 1
    };

    bs.init(bsOptions, (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
      // Callback:
      //    console.log(data.options.get("urls").get("ui"));
      //    console.log(data.options.get("urls").get("ui-external"));
      //    console.log(bs.getOption("urls"));
    });
  });
}

export function reload(host: string, inputList: string[]): void {
  // TODO since we can hit this at the same time when working with multiple servers
  // make sure we don't get into any concurrency trouble
  const instance = instances[host];
  const bs = browserSync.get(instance.name);

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
    const clientLibs = instance.clientlibTree.findClientlibs(cssBase);
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
    console.log(
      instance.name + ": Only styling was changed, try to inject",
      cssToRefresh
    );
    bs.reload(cssToRefresh);
  } else {
    bs.reload();

    // Update clientlibTree if something changed in the clientlib structure (do after reload since is needed for next update)
    // TODO make async
    // TODO wait with next push/update until this is done
    if (specialPaths.length > 0) {
      console.log(
        instance.name +
          ": Special paths were changed, so rebuild clientlib tree"
      );
      // Something changed in the structure, so rebuild all clientlib stuff
      // TODO make function for this

      // // Setup clientlib stuff
      sw = Date.now();
      // TODO reuse objects and only reinit?
      const promises = [];
      instance.clientlibTree = new ClientlibTree({
        name: instance.name,
        server: instance.server
      });
      promises.push(instance.clientlibTree.init());
      // DOn't update style three, since it happened in the prvious step (if there were any less/css/csstxt changes)
      // TODO maybe leave it in, as a catch-all in case we miss something when updating the file tree
      Promise.all(promises)
        .then(() => {
          // console.log(`Init clientlibs finished`);
          console.log(
            instance.name +
              ": Rebuild clientlib tree: " +
              (Date.now() - sw) +
              " ms"
          );
        })
        .catch(reason => {
          console.log(instance.name + `: Rebuild rejected: ${reason}`);
        });
    }
  }
}
