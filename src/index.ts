import { Pipeline, Watcher } from "aemsync";
import chalk from "chalk";
import gfs from "graceful-fs";
import minimist from "minimist";
import opn from "opn";
import path from "path";
import url from "url";
import * as bsWrapper from "./bs-wrapper";

import packageInfo from "./../package.json";

function separate() {
  console.log("---------------------------------------");
}

// Command line options
const MSG_HELP = `Usage: aemfed [OPTIONS]
Options:
  -t targets           Default is http://admin:admin@localhost:4502
  -w path_to_watch     Default is current
  -e exclude_filter    Anymatch exclude filter; disabled by default
  -i sync_interval     Update interval in milliseconds; default is 100
  -o open_page         Browser page to be opened after successful launch; default is "false".
  -b browser           Browser where page should be opened in; this parameter is platform dependent; for example, Chrome is "google chrome" on OS X, "google-chrome" on Linux and "chrome" on Windows; default is "google chrome"
  -h                   Displays this screen
  -v                   Displays version of this package`;

function reloadBrowser(
  error: string,
  host: string,
  inputList: string[],
  packItems: Pipeline.PackItem[]
) {
  if (!error) {
    bsWrapper.reload(host, inputList);
  } else {
    console.error(host + ": Error when pushing pack: ", error);
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

  const workingDirs: string[] = [];
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
  const pushInterval: number = args.i || 100;
  const exclude: string = args.e || "";
  const startPage: string = args.o || "false";
  const startBrowser: string = args.browser || "google chrome";

  separate();
  console.log("Working dirs:", workingDirs);
  console.log("Targets:", targets);
  console.log("Interval:", pushInterval);
  console.log("Exclude:", exclude);
  separate();

  // Config BrowserSync
  const targetList = targets.split(",");
  if (targetList.length > 1) {
    console.log(
      chalk.cyan(
        "Warning: multiple targets, so for now only the first one is proxied!"
      )
    );
  }

  // use string because the regex object maintains state, so can't be reused safely
  const styleLinkPattern =
    '(<link rel="stylesheet" href="/[^">]*?)(.min)?(.[0-9a-f]{32})?(.css)("[^>]*>)';
  bsWrapper.create({
    bsOptions: {
      rewriteRules: [
        {
          fn: (req, res, matchedLinkElement) => {
            const regex = new RegExp(styleLinkPattern, "i"); // g is not needed since we work with single item
            const match = regex.exec(matchedLinkElement);
            if (match) {
              // Return the part w/o .min and .hash for easier matching when injecting
              // Add cache buster based on bs Reloader.prototype.generateUniqueString
              return (
                match[1] + match[4] + "?browsersync=" + Date.now() + match[5]
              );
            } else {
              console.warn(
                "Could not rematch " +
                  matchedLinkElement +
                  " to rewrite url w/o .min and .hash"
              );
              return matchedLinkElement;
            }
          },
          match: new RegExp(styleLinkPattern, "gi")
        }
      ]
    },
    jcrContentRoots: workingDirs,
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
