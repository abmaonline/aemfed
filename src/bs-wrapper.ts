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
  bundles: IBundles;
  configs: IConfigs;
}
// Bundles
interface IBundles {
  tracer?: IBundleData;
}
interface IBundleData {
  id: number;
  name: string;
  fragment: boolean;
  stateRaw: number;
  state: string;
  version: string;
  symbolicName: string;
  category: string;
  props: IBundleProp[];
}
interface IBundleProp {
  key: string;
  value: any;
}
// Configs
interface IConfigs {
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
  getJcrRef?(
    message: string,
    instance: Instance
  ): messages.ISourceFileReference | undefined;
  fixJcrRef?(
    sourceRef: messages.ISourceFileReference,
    instance: Instance
  ): Promise<messages.ISourceFileReference>;
}
interface ITracerConfig {
  pattern: RegExp;
  profiles: ITracerProfile[];
}

/**
 * Try to update the ref with the individual file info based on uber line nr from combined client lib
 * @param ref Source file reference from the error message with line nr based on combined javascript files
 * @param instance Server instance with the javascript client lib tree we use to find individual file
 * @returns Promise with the ref itself with updated info, but since it is an object, it is the same reference as the provided parameter
 */
function fixJsPath(
  ref: messages.ISourceFileReference,
  instance: Instance
): Promise<messages.ISourceFileReference> {
  if (ref.jcrPath && typeof ref.line === "number") {
    return instance.clientlibTree.jsTrees
      .getMappedFile(ref.jcrPath, ref.line)
      .then(jsFileMapped => {
        // Something was mapped, so update ref with data
        if (jsFileMapped) {
          ref.jcrPath = jsFileMapped.path;
          ref.line = jsFileMapped.line; // Compensate for extra lines from files before this
          messages.setFilePath(ref, config.jcrContentRoots);
        }
        return ref;
      });
  } else {
    return Promise.resolve(ref);
  }
}

// Sling Tracer profiles
// TODO do something about a lot of duplicate errors for YUI processor
// tslint:disable:object-literal-sort-keys
const yuiProfile: ITracerProfile = {
  level: "error",
  logger: "com.adobe.granite.ui.clientlibs.impl.YUIScriptProcessor",
  getJcrRef: message => {
    // Only check for lines and columns, since no other info in message
    const sourceRef = messages.getRef(
      message,
      /(\d+):(\d+):/,
      config.jcrContentRoots,
      {
        line: 1,
        column: 2,
        jcrPath: -1,
        filePath: -1
      }
    );
    return sourceRef;
  },
  fixJcrRef: (sourceRef, instance) => {
    // Try to get the individual js file name, based on uber line nr
    // Make sure all data is loaded into JsTrees
    return fixJsPath(sourceRef, instance);
  },
  postProcess: message => {
    // YUI adds a new line and it's own ERROR prefix for each line: strip it
    return message.replace(/^\n\[ERROR\] /, "");
  }
};
const jscompProfile: ITracerProfile = {
  level: "error",
  logger: "com.google.javascript.jscomp",
  getJcrRef: (message, instance) => {
    const sourceRef = messages.getRef(
      message,
      /^([^:[\]*'"|\s]+):(\d+):/,
      config.jcrContentRoots,
      {
        jcrPath: 1,
        line: 2,
        column: -1,
        filePath: -1
      }
    );
    if (sourceRef) {
      // Try to get column from line with ^ indicator
      // Only works when indented with spaces, since we don't know the tab width
      const match = /^( *\^)$/gm.exec(message);
      if (match) {
        sourceRef.column = match[1].length;
      }
    }
    return sourceRef;
  },
  fixJcrRef: (sourceRef, instance) => {
    // Try to get the individual js file name, based on uber line nr
    // Make sure all data is loaded into JsTrees
    return fixJsPath(sourceRef, instance);
  }
};
const gccProfile: ITracerProfile = {
  level: "error",
  logger:
    "com.adobe.granite.ui.clientlibs.processor.gcc.impl.GCCScriptProcessor"
};
const lessProfile: ITracerProfile = {
  level: "error",
  logger: "com.adobe.granite.ui.clientlibs.compiler.less.impl.LessCompilerImpl",
  getJcrRef: message => {
    // illegal jcr chars (but added '/' since we want complete path):
    // https://helpx.adobe.com/experience-manager/6-3/sites/developing/using/reference-materials/javadoc/com/day/cq/commons/jcr/JcrUtil.html
    const sourceRef = messages.getRef(
      message,
      /([^:[\]*'"|\s]+) on line (\d+), column (\d+)/,
      config.jcrContentRoots
    );
    return sourceRef;
  }
};
const htmlLibProfile: ITracerProfile = {
  level: "error",
  logger: "com.adobe.granite.ui.clientlibs.impl.HtmlLibraryManagerImpl",
  getJcrRef: message => {
    // Only check for js for now
    const sourceRef = messages.getRef(
      message,
      /Error during assembly of (\/[^:[\]*'"|\s]+\.js)/,
      config.jcrContentRoots,
      {
        jcrPath: 1,
        filePath: -1,
        line: -1,
        column: -1
      }
    );
    return sourceRef;
  }
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
            generateReport(instance, url, slingTracerRequestId, trace).then(
              report => {
                report.map(line => console.log(line));
              }
            );
          }
        }
      });
    }, 100);
  }
}

// Used for filtering duplicates in .filter
function onlyUnique<T>(value: T, index: number, self: T[]): boolean {
  return self.indexOf(value) === index;
}

interface IReportMessage {
  traceLog?: ILog;
  postMessage?: string;
  profile?: ITracerProfile;
  sourceRef?: messages.ISourceFileReference;
}

function generateReport(
  instance: Instance,
  url: string | undefined,
  slingTracerRequestId: string,
  trace: ITracer
): Promise<string[]> {
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

  report.push(
    chalk`[{blue ${instance.name}}] Tracer output for [{yellow ${url ||
      "[url missing]"}}] (${slingTracerRequestId})`
  );

  const reportMessages: IReportMessage[] = [];
  // Magic for JS
  const onlyLines: IReportMessage[] = [];
  const onlyPaths: IReportMessage[] = [];

  trace.logs.map(traceLog => {
    const className = traceLog.logger.substr(
      traceLog.logger.lastIndexOf(".") + 1
    );
    const coloredLevel = levelColorMap[traceLog.level.toLowerCase()](
      traceLog.level
    );
    const message: IReportMessage = { traceLog };

    // Check profile specific processing of message
    const profile = profiles.find(p => traceLog.logger === p.logger);
    if (profile) {
      message.profile = profile;
      // Try to translate JCR references back to local files
      if (typeof profile.getJcrRef === "function") {
        message.sourceRef = profile.getJcrRef(traceLog.message, instance);
        // reportMessage
        if (message.sourceRef) {
          const hasPath =
            message.sourceRef.jcrPath ||
            message.sourceRef.absoluteFilePath ||
            message.sourceRef.relativeFilePath;
          const hasLine = typeof message.sourceRef.line === "number";
          // Add to list
          if (hasPath && hasLine) {
            // Complete, so add direct to sourceFileRefs
            reportMessages.push(message);
          } else {
            // Something is missing, try to fix
            // Mainly for YUI
            if (!hasPath && hasLine) {
              // Only lines, so check if there are still onlyPaths present and clean up
              if (onlyPaths.length) {
                // First cleanup since last run
                processOnlies();
              }
              onlyLines.push(message);
            } else if (hasPath && !hasLine) {
              onlyPaths.push(message);
            }
          }
        }
      }
      // If function available, clean up log message
      if (typeof profile.postProcess === "function") {
        message.postMessage = profile.postProcess(traceLog.message);
      }
    }
    report.push(
      chalk`[${coloredLevel}] {cyan ${className}}: ${message.postMessage ||
        traceLog.message}`
    );
  });

  if (onlyPaths.length) {
    processOnlies();
  }

  function processOnlies() {
    // onlyPaths deduplicate: pick first (since probably
    // related to onlyLines that came before it)
    const uniquePathMessages: IReportMessage[] = [];
    onlyPaths.forEach(message => {
      const onlyPath = message.sourceRef;
      if (
        onlyPath &&
        onlyPath.jcrPath &&
        !uniquePathMessages.some(
          up =>
            typeof up.sourceRef !== "undefined" &&
            up.sourceRef.jcrPath === onlyPath.jcrPath
        )
      ) {
        uniquePathMessages.push(message);
      }
    });

    if (uniquePathMessages.length) {
      uniquePathMessages.forEach((uniquePath, upIndex) => {
        const pathRef = uniquePath.sourceRef;
        if (upIndex === 0 && onlyLines.length && pathRef) {
          // For first uniquePath try to apply all onlyLines if any
          onlyLines.forEach((message, index) => {
            const lineRef = message.sourceRef;
            if (lineRef) {
              if (
                onlyLines.length === index + 1 &&
                lineRef &&
                lineRef.line === 1 &&
                lineRef.column === 0
              ) {
                // Last message has 1:0: which means summary and not relevant so skip
              } else {
                lineRef.jcrPath = pathRef.jcrPath;
                // Store in final list
                reportMessages.push(message);
              }
            }
          });
        } else {
          // Just push all remaining paths
          reportMessages.push(uniquePath);
        }
      });
    }
    // Done, empty onlyLines and onlyPaths before filling them again
    onlyLines.splice(0, onlyLines.length);
    onlyPaths.splice(0, onlyPaths.length);
  }

  // Process errors in request progress log (descriptive sightly errors are only in here)
  const requestProgressErrorLogs = trace.requestProgressLogs
    .map(message => {
      const match = /\d+ LOG SCRIPT ERROR: (.*)/.exec(message);
      if (match) {
        const postMessage = match[1];
        // Test if not a ScriptEvaluationException with empty message
        // (thrown several times in the upstream stack trace)
        // In AEM 6.4 it is thrown also with the original message...
        if (!/ScriptEvaluationException:$/.test(postMessage)) {
          // Try to find jcr paths
          const ref = messages.getRef(
            message,
            /([^:[\]*'"|\s]+) at line number (\d+) at column number (\d+)/,
            config.jcrContentRoots
          );
          if (ref) {
            reportMessages.push({
              postMessage,
              sourceRef: ref
            });
          }

          // Write out message
          return chalk`[{red ERROR}] {cyan Sling Request Progress Tracker}: ${postMessage}`;
        }
      }
    })
    .filter(message => typeof message === "string") as string[];

  // All sourceRefs are present, last fix round
  const promises: Array<Promise<messages.ISourceFileReference>> = [];
  for (const { sourceRef, profile } of reportMessages) {
    if (profile && sourceRef) {
      if (typeof profile.fixJcrRef === "function") {
        promises.push(profile.fixJcrRef(sourceRef, instance));
      }
    }
  }

  return Promise.all(promises).then(fixedRefs => {
    // We're not interested in fixedRefs, only that they have been fixed
    const uniqueLocalPaths = reportMessages
      .map(ref => ref.sourceRef && messages.formatMessage(ref.sourceRef))
      .filter((filePath): filePath is string => typeof filePath === "string")
      .filter(onlyUnique);

    return report.concat(requestProgressErrorLogs, uniqueLocalPaths);
  });
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

function setSlingTracerBundleInfo(instance: Instance): Promise<Instance> {
  const symbolicName = "org.apache.sling.tracer";
  const url = instance.server + `/system/console/bundles/${symbolicName}.json`;

  return rpn({
    json: true,
    uri: url
  }).then((data: any) => {
    if (data && data.data && data.data.length > 0) {
      const bundleData = data.data[0];
      if (
        Object.keys(bundleData).length > 0 &&
        bundleData.symbolicName === symbolicName
      ) {
        instance.aemSettings.bundles.tracer = bundleData;
      }
    }
    return instance;
  });
}

function setSlingTracerSettings(instance: Instance): Promise<Instance> {
  const buster = `${Date.now()}`.slice(-3);
  // TODO use constant for this path, since also used in message
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
      instance.aemSettings.configs.tracer = {
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
      aemSettings: {
        bundles: {},
        configs: {}
      },
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
      setSlingTracerBundleInfo(instance)
        .then(() => {
          const tracerBundle = instance.aemSettings.bundles.tracer;
          // 0.0.2 is the only version that doesn't support the tracers with the servlet
          // But it can be replaced with 1.0.2 on all AEM 6.0+ instances
          if (tracerBundle && tracerBundle.version !== "0.0.2") {
            // Tracer present and valid, check its configuration
            return setSlingTracerSettings(instance).then(() => {
              if (instance.aemSettings.configs.tracer) {
                const tracerEnabled =
                  instance.aemSettings.configs.tracer.enabled &&
                  instance.aemSettings.configs.tracer.servletEnabled;
                if (!tracerEnabled) {
                  // TODO move path to constant for reuse in call getting json
                  console.log(
                    chalk`[{blue ${
                      instance.name
                    }}] {cyan Apache Sling Log Tracer is not enabled, so errors from compiling and minifying Less and Javascript by AEM cannot be shown. To enable it, go to [{yellow ${
                      instance.server
                    }/system/console/configMgr/org.apache.sling.tracer.internal.LogTracer}] and turn on both 'Enabled' and 'Recording Servlet Enabled'. No restart of aemfed needed}.`
                  );
                }
              } else {
                console.log(
                  chalk`[{blue ${
                    instance.name
                  }}] {cyan Apache Sling Log Tracer config was not found}.`
                );
              }
              return instance;
            });
          } else {
            // No valid tracer, show message about upgrade
            const reason = tracerBundle
              ? `too old (version ${tracerBundle.version})`
              : `not installed`;
            console.error(
              chalk`[{blue ${
                instance.name
              }}] {cyan Apache Sling Log Tracer bundle is ${reason}. At least version 1.0.0 is needed for aemfed to intercept AEM error messages. AEM 6.2 and before can install and run 1.0.2 or newer, see the 'Updating Sling Log Tracer' section in the README for instructions}.`
            );
            return instance;
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
  const jsPaths: string[] = [];
  const jstxtPaths: string[] = [];
  const specialPaths: string[] = [];

  inputList.forEach(absolutePath => {
    // console.log('item', item);
    if (absolutePath) {
      if (/\.(css|less|scss)$/.test(absolutePath)) {
        cssPaths.push(absolutePath);
      } else if (/\.(js)$/.test(absolutePath)) {
        jsPaths.push(absolutePath);
      } else if (/\.(html|jsp)$/.test(absolutePath)) {
        html = true;
      } else if (/css\.txt$/.test(absolutePath)) {
        csstxtPaths.push(absolutePath);
      } else if (/js\.txt$/.test(absolutePath)) {
        jstxtPaths.push(absolutePath);
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
  js = js || jsPaths.length > 0; // Don't include jsTxtFiles here yet, since not needed
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

  // console.log("Determine dependencies: " + (Date.now() - sw) + " ms");

  if (css && !js && !html && !other) {
    console.log(
      chalk`[{blue ${instance.name}}] Only styling was changed, try to inject`
    );
    bs.reload(cssToRefresh);
  } else {
    if (js) {
      // Fix js before reloading, so links can be generated immediately
      // First make paths relative to correct jcr_root
      const relativeJsPaths: string[] = [];
      jsPaths.forEach(filePath => {
        config.jcrContentRoots.forEach(rootDir => {
          if (filePath.indexOf(rootDir) === 0) {
            // Found correct root
            const relativeJcrPath = filePath.replace(rootDir, "");
            relativeJsPaths.push(relativeJcrPath);
          }
        });
      });

      // Remove relative paths from jstree cache (will be updated when needed)
      instance.clientlibTree.jsTrees.resetFiles(relativeJsPaths);
    }

    if (specialPaths.length > 0 || jstxtPaths.length > 0) {
      // If special paths were changed, reset the list of libs (but leave files alone)
      instance.clientlibTree.jsTrees.resetLibs();
    }

    // When js files have been invalidated, trigger reload
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
