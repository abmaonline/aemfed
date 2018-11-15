// Based on https://github.com/zeit/update-check
import fs from "fs";
import { tmpdir } from "os";
import { join } from "path";
import ProxyAgent from "proxy-agent";
import rpn from "request-promise-native";
// WARNING: The typing for this version of promisify is 'any[]', so not very helpfull.
// Works ok in Node.js 8.10.x, but copying the definitions from there, doesn;t have the
// same effect (maybe because the structure of the typing of the fs module also changed).
import promisify from "util.promisify";

const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);
const readFile = promisify(fs.readFile);

interface IFileContent {
  latest: string;
  lastUpdate: number;
}

interface IDistResponse {
  [key: string]: string;
}

interface IConfig {
  interval: number;
  distTag: string;
  url: string;
}

const compareVersions = (a: string, b: string) =>
  a.localeCompare(b, "en-US", { numeric: true });

const getFile = async (name: string, distTag: string) => {
  const rootDir = tmpdir();
  const subDir = join(rootDir, "update-check");

  if (!fs.existsSync(subDir)) {
    await mkdir(subDir);
  }

  const fileName = `${name}-${distTag}.json`;

  return join(subDir, fileName);
};

const evaluateCache = async (file: string, time: number, interval: number) => {
  if (fs.existsSync(file)) {
    const content = await readFile(file, "utf8");
    const { lastUpdate, latest }: IFileContent = JSON.parse(content);
    const nextCheck = lastUpdate + interval;

    // As long as the time of the next check is in
    // the future, we don't need to run it yet
    if (nextCheck > time) {
      return {
        latest,
        shouldCheck: false
      };
    }
  }

  return {
    latest: undefined,
    shouldCheck: true
  };
};

const updateCache = async (
  file: string,
  latest: string,
  lastUpdate: number
) => {
  const fileContent: IFileContent = {
    lastUpdate,
    latest
  };
  const content = JSON.stringify(fileContent);

  await writeFile(file, content);
};

const loadPackage = (url: string, packageInfo: any) => {
  const userAgent = `Mozilla/5.0 (${process.platform}; ${
    process.arch
  }) Node.js/${process.version.slice(1)} ${packageInfo.name}/${
    packageInfo.version
  }`;

  // Determine proxy
  const proxyAddress =
    process.env.http_proxy ||
    process.env.HTTP_PROXY ||
    process.env.https_proxy ||
    process.env.HTTPS_PROXY;
  const proxyAgent = proxyAddress ? new ProxyAgent(proxyAddress) : undefined;

  const options = {
    agent: proxyAgent,
    headers: {
      "User-Agent": userAgent
    },
    json: true,
    timeout: 2000
  };

  return rpn(url, options);
};

const getMostRecent = async (
  url: string,
  distTag: string,
  packageInfo: any
) => {
  const spec: IDistResponse = await loadPackage(url, packageInfo);
  const version = spec[distTag];

  if (!version) {
    throw new Error(`Distribution tag '${distTag}' is not available`);
  }

  return version;
};

const defaultConfig: IConfig = {
  distTag: "latest",
  interval: 3600000,
  url: "https://aemfed.io/latest"
};

export async function check(packageInfo: any, config?: IConfig) {
  if (typeof packageInfo !== "object") {
    throw new Error(
      "The first parameter should be your package.json file content"
    );
  }

  const name = packageInfo.name;
  const time = Date.now();
  const { distTag, interval, url } = { ...defaultConfig, ...config };
  const file = await getFile(name, distTag);

  let latest;
  let shouldCheck = true;

  ({ shouldCheck, latest } = await evaluateCache(file, time, interval));

  if (shouldCheck) {
    latest = await getMostRecent(url, distTag, packageInfo);

    // If we pulled an update, we need to update the cache
    await updateCache(file, latest, time);
  }

  if (latest) {
    const comparision = compareVersions(packageInfo.version, latest);

    if (comparision === -1) {
      return {
        fromCache: !shouldCheck,
        latest
      };
    }
  }

  return;
}
