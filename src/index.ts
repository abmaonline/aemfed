import { Pipeline, Watcher } from "aemsync";
import chalk from "chalk";
import decode from "decode-html";
import gfs from "graceful-fs";
import minimist from "minimist";
import opn from "opn";
import path from "path";
import packageInfo from "./../package.json";
import * as bsWrapper from "./bs-wrapper";
import * as messages from "./messages";
import * as UpdateCheck from "./update-check";
// vscode and tslint order the '= require' differently
// tslint:disable-next-line:ordered-imports
import bsQrCodePlugin = require("./bs-qr-code");

function separate() {
  console.log("---------------------------------------");
}

// Command line options
const MSG_HELP = `Usage: aemfed [OPTIONS]
Options:
  -t targets           Default is http://admin:admin@localhost:4502
  -p proxy_port        Default is 3000
  -w path_to_watch     Default is current
  -e exclude_filter    Anymatch exclude filter; disabled by default
  -i sync_interval     Update interval in milliseconds; default is 100
  -o open_page         Browser page to be opened after successful launch; default is "false".
  -b browser           Browser where page should be opened in; this parameter is platform dependent; for example, Chrome is "google chrome" on OS X, "google-chrome" on Linux and "chrome" on Windows; default is "google chrome"
  -q load_qr           Enable QR code plugin for connected browsers; default is "true".
  -h                   Displays this screen
  -v                   Displays version of this package`;

const workingDirs: string[] = [];

function reloadBrowser(
  error: string,
  host: string,
  inputList: string[],
  packItems: Pipeline.PackItem[]
) {
  if (!error) {
    bsWrapper.reload(host, inputList);
  } else {
    console.error(
      chalk`[{blue ${host}}] [{red Error}] when pushing pack: ${decode(error)}`
    );

    // Only use section after jcr_root, since path itself doesn't exist
    const ref = messages.getRef(
      error,
      /systemId: file:\/\/.*?\/jcr_root(\/.*?); lineNumber: (\d+); columnNumber: (\d+);/,
      workingDirs
    );
    const logLine = messages.formatMessage(ref);
    if (logLine) {
      console.log(logLine);
    }
  }
}

export function init(): void {
  "use strict";

  const args = minimist(process.argv.slice(2));

  // Show help
  if (args.h) {
    console.log(MSG_HELP);
    return;
  }

  // Show version
  if (args.v) {
    console.log(packageInfo.version);
    return;
  }

  // Reset workingDirs in case we restart?
  workingDirs.splice(0, workingDirs.length);
  const dirs = args.w ? args.w : ".";
  dirs.split(",").forEach((dir: string) => {
    const absDir = path.resolve(dir);
    if (!gfs.existsSync(absDir)) {
      console.log("Invalid path, so skipping:", chalk.yellow(absDir));
    } else {
      workingDirs.push(absDir);
    }
  });

  if (workingDirs.length === 0) {
    console.log("No valid paths found in: ", chalk.yellow(args.w));
    return;
  }

  // TODO make some sort of defaults file and get defaults from there (and use in all modules)
  const targets: string = args.t || "http://admin:admin@localhost:4502";
  const proxyPort: number = parseInt(args.p, 10) || 3000;
  const pushInterval: number = parseInt(args.i, 10) || 100;
  const exclude: string = args.e || "";
  const startPage: string = args.o || "false";
  const startBrowser: string = args.b || "google chrome";

  // Build browser sync plugins list
  const bsPlugins = [];
  if (args.q !== "false") {
    bsPlugins.push({
      module: bsQrCodePlugin,
      options: {
        onload: false
      }
    });
  }

  separate();
  console.log("Working dirs:", workingDirs);
  console.log("Targets:", targets);
  console.log("Proxy port:", proxyPort);
  console.log("Interval:", pushInterval);
  console.log("Exclude:", exclude);
  separate();
  console.log(
    chalk`If something is missing or not working as expected, open an issue on GitHub: {yellow https://github.com/abmaonline/aemfed/issues}`
  );
  separate();

  // TODO after restructuring bs-wrapper include in initialization chain
  UpdateCheck.check(packageInfo)
    .then(update => {
      const message = messages.formatUpdateMessage(update);
      if (message) {
        console.log(message);
      }
    })
    .catch(err => {
      // TODO check what to show
      console.error(`Failed to check for updates: ${err}`);
    });

  // Config BrowserSync
  const targetList = targets.split(",");

  // use string because the regex object maintains state, so can't be reused safely
  // Caution: group numbers are used to build the final statement, so they must remain the same
  // For styling remove the parts for .min and .hash from group 1, so Browsersync is better able
  // to match the file names provided by aemfed to the names in the html of the page when
  // trying to injecting new styling changes
  const styleLinkPattern =
    '(<link rel="stylesheet" href="/[^">]*?)(.min)?(.[0-9a-f]{32})?(.css)("[^>]*>)';
  // Don't strip .min or hash from js, since it is not injected (and .min is needed to trigger compressor)
  // To keep regex group nr's the same, nest them in group 1
  const jsScriptPattern =
    '(<script type=".*?/javascript" src="/[^">]*?(.min)?(.[0-9a-f]{32})?)(.js)("[^>]*>)';

  function rewriteClientlibIncludes(
    matchedLinkElement: string,
    pattern: string
  ) {
    const regex = new RegExp(pattern, "i"); // g is not needed since we work with single item
    const match = regex.exec(matchedLinkElement);
    if (match) {
      // Add cache buster to prevent caching issues when something like
      // ACS Commons Versioned Clientlibs is not used
      return match[1] + match[4] + "?browsersync=" + Date.now() + match[5];
    } else {
      console.warn(
        "Could not rematch " +
          matchedLinkElement +
          " to rewrite url w/o .min and .hash"
      );
      return matchedLinkElement;
    }
  }

  bsWrapper.create({
    bsOptions: {
      plugins: bsPlugins,
      rewriteRules: [
        {
          fn: (req, res, matchedLinkElement) => {
            return rewriteClientlibIncludes(
              matchedLinkElement,
              styleLinkPattern
            );
          },
          match: new RegExp(styleLinkPattern, "gi")
        },
        {
          fn: (req, res, matchedLinkElement) => {
            return rewriteClientlibIncludes(
              matchedLinkElement,
              jsScriptPattern
            );
          },
          match: new RegExp(jsScriptPattern, "gi")
        }
      ]
    },
    jcrContentRoots: workingDirs,
    proxyPort,
    servers: targetList
  });

  // Start aemsync
  const pipelineArgs: Pipeline.Args = {
    interval: 600,
    onPushEnd: reloadBrowser,
    targets: targetList
  };
  const pipeline = new Pipeline(pipelineArgs);
  // Initialize queue processing
  pipeline.start();

  // Watch over workingDirs
  const watcher = new Watcher();
  const watcherArgs: Watcher.Args = {
    callback: localPath => {
      // This is before processing, so we can determine here what to do
      // TODO is this timeout needed for the interval? Pipeline has it's own option for an interval?
      // Add item to Pipeline's queue when a change is detected
      setTimeout(() => {
        pipeline.enqueue(localPath);
      }, pushInterval);
    },
    exclude,
    workingDirs
  };
  watcher.watch(watcherArgs);

  if (startPage !== "false") {
    opn(startPage, {
      app: startBrowser
    });
  }

  separate();
}
