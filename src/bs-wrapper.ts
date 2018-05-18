import browserSync from "browser-sync";
import chalk from "chalk";
import gfs from "graceful-fs";
import http from "http";
import path from "path";
import rpn from "request-promise-native";
import { ClientlibTree } from "./clientlib-tree";
import * as messages from "./messages";
import { StyleTrees } from "./style-trees";

export interface IWrapperConfig {
  bsOptions: browserSync.Options;
  jcrContentRoots: string[];
  proxyPort: number;
  servers: string[];
  dumpLibsPath?: string;
}

interface Instance {
  clientlibTree: ClientlibTree;
  name: string;
  online: boolean;
  port: number;
  server: string;
  aemSettings: IAemSettings;
}

interface IAemSettings {
  // mode: string;
  tracer?: ITracerSettings;
}
interface ITracerSettings {
  enabled: boolean;
  servletEnabled: boolean;
  recordingCacheSizeInMB: number;
  recordingCacheDurationInSecs: number;
  recordingCompressionEnabled: boolean;
  gzipResponse: boolean;
}

const instances: { [key: string]: Instance } = {};

let styleTrees: StyleTrees;
let config: IWrapperConfig;

// Sling Tracer logic
// TODO move to own file?
interface ITracerProfile {
  logger: string;
  level?: string;
  caller?: boolean | number;
  callerExcludeFilter?: string[];
  postProcess?(message: string): string;
  getJcrRef?(message: string): messages.ISourceFileReference | undefined;
}
interface ITracerConfig {
  pattern: RegExp;
  profiles: ITracerProfile[];
}

// Sling Tracer profiles
// TODO do something about a lot of duplicate errors for YUI processor
// tslint:disable:object-literal-sort-keys
const yuiProfile: ITracerProfile = {
  level: "error",
  logger: "com.adobe.granite.ui.clientlibs.impl.YUIScriptProcessor",
  postProcess: message => {
    // YUI adds a new line and it's own ERROR prefix for each line: strip it
    return message.replace(/^\n\[ERROR\] /, "");
  }
};
const jscompProfile: ITracerProfile = {
  level: "error",
  logger: "com.google.javascript.jscomp"
};
const gccProfile: ITracerProfile = {
  level: "error",
  logger:
    "com.adobe.granite.ui.clientlibs.processor.gcc.impl.GCCScriptProcessor"
};
const lessProfile: ITracerProfile = {
  level: "error",
  logger: "com.adobe.granite.ui.clientlibs.compiler.less.impl.LessCompilerImpl",
  getJcrRef: (message: string) => {
    // illegal jcr chars (but added '/' since we want complete path):
    // https://helpx.adobe.com/experience-manager/6-3/sites/developing/using/reference-materials/javadoc/com/day/cq/commons/jcr/JcrUtil.html
    return messages.getRef(
      message,
      /([^:[\]*'"|\s]+) on line (\d+), column (\d+)/,
      config.jcrContentRoots
    );
  }
};
const htmlLibProfile: ITracerProfile = {
  level: "error",
  logger: "com.adobe.granite.ui.clientlibs.impl.HtmlLibraryManagerImpl"
};
const cacheLibProfile: ITracerProfile = {
  level: "error",
  logger: "com.adobe.granite.ui.clientlibs.impl.LibraryCacheImpl"
};
const acsProfile: ITracerProfile = {
  level: "error",
  logger:
    "com.adobe.acs.commons.rewriter.impl.VersionedClientlibsTransformerFactory"
};
const slingProcessorProfile: ITracerProfile = {
  level: "error",
  logger: "org.apache.sling.engine.impl.SlingRequestProcessorImpl"
};
// tslint:enable:object-literal-sort-keys
// Used for querying
const profiles = [
  yuiProfile,
  jscompProfile,
  gccProfile,
  lessProfile,
  htmlLibProfile,
  cacheLibProfile,
  acsProfile,
  slingProcessorProfile
];

// Tracer configs
const tracerConfigs: ITracerConfig[] = [
  // Page, most logging is present in call to page itself (especially for gcc)
  {
    pattern: /\.html(\?.*|$)/,
    profiles: [
      yuiProfile,
      jscompProfile,
      gccProfile,
      lessProfile,
      htmlLibProfile,
      cacheLibProfile,
      acsProfile,
      slingProcessorProfile
    ]
  },
  // Styling, for individual calls to css in case of injection
  {
    pattern: /\.css(\?.*|$)/,
    profiles: [lessProfile, htmlLibProfile, cacheLibProfile]
  },
  // Javascript, in case of requesting individual js files
  {
    pattern: /\.js(\?.*|$)/,
    profiles: [
      yuiProfile,
      jscompProfile,
      gccProfile,
      htmlLibProfile,
      cacheLibProfile
    ]
  }
];

function setTracerHeaders(
  proxyReq: http.ClientRequest,
  req: http.IncomingMessage,
  configs: ITracerConfig[]
) {
  const url = req.url;
  configs.forEach(tracerConfig => {
    if (url && tracerConfig.pattern.test(url)) {
      const configStrings = tracerConfig.profiles.map(
        ({ logger, level, caller, callerExcludeFilter }) => {
          const fragments = [logger];
          if (level) {
            fragments.push(`level=${level}`);
          }
          if (caller === true || typeof caller === "number") {
            fragments.push(`caller=${caller}`);
          }
          if (callerExcludeFilter && callerExcludeFilter.length) {
            fragments.push(
              `caller-exclude-filter="${callerExcludeFilter.join("|")}"`
            );
          }
          return fragments.join(";");
        }
      );
      proxyReq.setHeader("Sling-Tracer-Record", "true");
      proxyReq.setHeader("Sling-Tracer-Config", configStrings.join(","));
    }
  });
}

function processTracer(
  proxyRes: http.IncomingMessage,
  url: string | undefined,
  instance: Instance
) {
  const header = proxyRes.headers["Sling-Tracer-Request-Id".toLowerCase()];
  const slingTracerRequestId = Array.isArray(header)
    ? header.length
      ? header[0]
      : ""
    : header;
  if (slingTracerRequestId) {
    // Use timeout, since json may not be ready yet
    setTimeout(() => {
      const tracerUrl =
        instance.server +
        "/system/console/tracer/" +
        slingTracerRequestId +
        ".json";

      rpn({
        json: true,
        uri: tracerUrl
      }).then((data: any) => {
        if (data && !data.error) {
          const trace: ITracer = data;
          if (trace.logs.length) {
            const report: string[] = generateReport(
              instance,
              url,
              slingTracerRequestId,
              trace
            );
            report.map(line => console.log(line));
          }
        }
      });
    }, 100);
  }
}

function generateReport(
  instance: Instance,
  url: string | undefined,
  slingTracerRequestId: string,
  trace: ITracer
) {
  // tslint:disable:object-literal-sort-keys
  const levelColorMap: {
    [key: string]: (message: string) => string;
  } = {
    error: chalk.red,
    warn: chalk.yellow,
    info: chalk.white,
    debug: chalk.reset,
    trace: chalk.grey
  };
  // tslint:enable:object-literal-sort-keys

  const report: string[] = [];
  const sourceFileRefs: messages.ISourceFileReference[] = [];

  report.push(
    chalk`[{blue ${instance.name}}] Tracer output for [{yellow ${url ||
      "[url missing]"}}] (${slingTracerRequestId})`
  );

  // Process direct logs
  trace.logs.map(({ logger, level, message }) => {
    const className = logger.substr(logger.lastIndexOf(".") + 1);
    const coloredLevel = levelColorMap[level.toLowerCase()](level);

    // Check profile specific processing of message
    const currentProfile = profiles.find(p => logger === p.logger);
    if (currentProfile) {
      // Try to translate JCR references back to local files
      if (typeof currentProfile.getJcrRef === "function") {
        const sourceFileRef = currentProfile.getJcrRef(message);
        if (sourceFileRef) {
          // Add to list
          sourceFileRefs.push(sourceFileRef);
        }
      }
      // If function available, clean up log message
      if (typeof currentProfile.postProcess === "function") {
        message = currentProfile.postProcess(message);
      }
    }
    report.push(chalk`[${coloredLevel}] {cyan ${className}}: ${message}`);
  });

  // Process errors in request progress log (descriptive sightly errors are only in here)
  const requestProgressErrorLogs = trace.requestProgressLogs
    .map(message => {
      const match = /\d+ LOG SCRIPT ERROR: (.*)/.exec(message);
      if (match) {
        // Test if not a ScriptEvaluationException with empty message
        // (thrown several times in the upstream stack trace)
        if (!/ScriptEvaluationException:$/.test(match[1])) {
          // Try to find jcr paths
          const ref = messages.getRef(
            message,
            /([^:[\]*'"|\s]+) at line number (\d+) at column number (\d+)/,
            config.jcrContentRoots
          );
          if (ref) {
            sourceFileRefs.push(ref);
          }

          // Write out message
          return chalk`[{red ERROR}] {cyan Sling Request Progress Tracker}: ${
            match[1]
          }`;
        }
      }
    })
    .filter(message => typeof message === "string") as string[];

  const localPaths = sourceFileRefs
    .map(ref => messages.formatMessage(ref))
    .filter(filePath => typeof filePath === "string") as string[];

  return report.concat(requestProgressErrorLogs, localPaths);
}

interface IOsgiConfig<T> {
  pid: string;
  title: string;
  description: string;
  properties: T;
  bundleLocation?: string;
  bundle_location?: string;
  service_location?: string;
}
interface IOsgiProperty<T> {
  name: string;
  optional: boolean;
  is_set: boolean;
  type: number;
  value: T | string; // If is_set is false, value is always a string it seems
  description: string;
}
interface IOsgiPropertiesTracer {
  // tracerSets: IOsgiProperty; // Multi value
  enabled: IOsgiProperty<boolean>;
  servletEnabled: IOsgiProperty<boolean>;
  recordingCacheSizeInMB: IOsgiProperty<number>;
  recordingCacheDurationInSecs: IOsgiProperty<number>;
  recordingCompressionEnabled: IOsgiProperty<boolean>;
  gzipResponse: IOsgiProperty<boolean>;
}

function setSlingTracerSettings(instance: Instance): Promise<Instance> {
  const buster = `${Date.now()}`.slice(-3);
  const url =
    instance.server +
    `/system/console/configMgr/org.apache.sling.tracer.internal.LogTracer?post=true&ts=${buster}`;

  return rpn({
    json: true,
    uri: url
  }).then((data: any) => {
    if (data && data.properties && Object.keys(data.properties).length > 0) {
      const { properties }: IOsgiConfig<IOsgiPropertiesTracer> = data;
      // Convert types any way, since default values are always send as strings it seems :sob:
      instance.aemSettings.tracer = {
        enabled: convert2Boolean(properties.enabled.value),
        gzipResponse: convert2Boolean(properties.gzipResponse.value),
        recordingCacheDurationInSecs: convert2Int(
          properties.recordingCacheDurationInSecs.value
        ),
        recordingCacheSizeInMB: convert2Int(
          properties.recordingCacheSizeInMB.value
        ),
        recordingCompressionEnabled: convert2Boolean(
          properties.recordingCompressionEnabled.value
        ),
        servletEnabled: convert2Boolean(properties.servletEnabled.value)
      };
    } else {
      // Something went wrong, so don't store these settings, but continue for next settings
    }
    return instance;
  });
}

function convert2Boolean(value: boolean | string): boolean {
  return typeof value === "string" ? value === "true" : value;
}

function convert2Int(value: number | string): number {
  return typeof value === "string" ? parseInt(value, 10) : value;
}

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
      aemSettings: {},
      clientlibTree: new ClientlibTree({ name, server }),
      name,
      online: true,
      port: args.proxyPort + index * 2, // Claim numbers for proxy and ui
      server
    };
    instances[host] = instance;
  });

  const hosts = Object.keys(instances);

  // Create promises to add instance state
  // TODO handle unresponsive server(s)
  const swInstanceState = Date.now();
  const promisesState: Array<Promise<any>> = [];
  hosts.forEach(host => {
    const instance = instances[host];
    promisesState.push(
      setSlingTracerSettings(instance)
        .then(sameInstance => {
          if (instance.aemSettings.tracer) {
            const tracerEnabled =
              instance.aemSettings.tracer.enabled &&
              instance.aemSettings.tracer.servletEnabled;
            if (!tracerEnabled) {
              console.log(
                chalk`[{blue ${
                  instance.name
                }}] {cyan Apache Sling Log Tracer is not enabled, so errors from compiling and minifying Less and Javascript by AEM cannot be shown. To enable it, go to [{yellow /system/console/configMgr}], search for 'Apache Sling Log Tracer' and turn on both 'Enabled' and 'Recording Servlet Enabled}'.`
              );
            }
          } else {
            console.log(
              chalk`[{blue ${
                instance.name
              }}] {cyan Apache Sling Log Tracer config was not found, so probably not supported in this version of AEM}.`
            );
          }
        })
        .catch(err => {
          console.error(
            chalk`[{blue ${
              instance.name
            }}] [{red ERROR}] Something went wrong:`,
            err
          );
        })
    );
  });

  return Promise.all(promisesState).then(() => {
    // Done with state
    console.log(
      "Get state for all instances: " + (Date.now() - swInstanceState) + " ms"
    );
    console.log("");

    // Setup clientlib stuff
    const swClientlibs = Date.now();

    const promisesClientlibs: Array<Promise<any>> = [];
    hosts.forEach(host => {
      const instance = instances[host];
      promisesClientlibs.push(instance.clientlibTree.init());
    });

    styleTrees = new StyleTrees(config.jcrContentRoots);
    promisesClientlibs.push(styleTrees.init());
    return Promise.all(promisesClientlibs)
      .then(() => {
        //   console.log(`Init clientlibs finished`);
        console.log(
          "Build style and clientlib trees: " +
            (Date.now() - swClientlibs) +
            " ms"
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
        console.error(`Init rejected: ${reason}`);
      });
  });
}

interface ITracer {
  method: string;
  time: number;
  timestamp: number;
  requestProgressLogs: string[];
  queries: IQuery[];
  logs: ILog[];
  loggerNames: string[];
}

interface ILog {
  timestamp: number;
  level: string;
  logger: string;
  message: string;
  params: string[];
}

interface IQuery {
  query: string;
  plan: string;
  caller: string;
}

function createBsInstancePromise(
  instance: Instance,
  bsOptions: browserSync.Options
): Promise<void> {
  return new Promise((resolve, reject) => {
    const bs = browserSync.create(instance.name);
    // Set server specific settings
    // TODO clone options first?
    bsOptions.proxy = {
      proxyReq: [
        (proxyReq, req, res, proxyOptions) => {
          setTracerHeaders(proxyReq, req, tracerConfigs);
        }
      ],
      proxyRes: [
        (proxyRes, req, res) => {
          processTracer(proxyRes, req.url, instance);
        }
      ],
      target: instance.server
    };
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
        let stat;
        try {
          stat = gfs.statSync(absolutePath);
        } catch (err) {
          if (err.code === "ENOENT") {
            // File not found anymore, thread as special so libs are rebuild
          } else {
            // Report on other errors
            console.error("Error:", absolutePath, err);
          }
        }

        if (!stat || stat.isDirectory()) {
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
      chalk`[{blue ${instance.name}}] Only styling was changed, try to inject`
    );
    bs.reload(cssToRefresh);
  } else {
    bs.reload();

    // Update clientlibTree if something changed in the clientlib structure (do after reload since is needed for next update)
    // TODO make async
    // TODO wait with next push/update until this is done
    if (specialPaths.length > 0) {
      console.log(
        chalk`[{blue ${
          instance.name
        }}] Special paths were changed, so rebuild clientlib tree`
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
          console.log(
            chalk`[{blue ${
              instance.name
            }}] [{red ERROR}] Rebuild rejected: ${reason}`
          );
        });
    }
  }
}
