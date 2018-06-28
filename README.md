# aemfed

Speed up your AEM front-end development using [aemsync](https://www.npmjs.com/package/aemsync), [BrowserSync](https://www.npmjs.com/package/browser-sync) and [this](https://github.com/abmaonline/aemfed).

## Features

- Watches changes in files and uploads them to AEM using [aemsync](https://www.npmjs.com/package/aemsync)
- Determines which clientlibs are affected by the uploaded changes
- Runs [BrowserSync](https://www.npmjs.com/package/browser-sync) in proxy modus so it can communicate with all open instances of your site without any browser plugins. It reloads these pages when the changes have been uploaded, or it only injects the new styling when only styling changes were made, maintaining the state of the page.
- Show serverside clientlib errors for each request

## Installation

In your project folder

```sh
npm install aemfed
```

## Usage

Show the available options

```sh
npx aemfed -h
```

When `npx` is not available, install it with

```sh
npm install -g npx
```

Run with specific server, ignore pattern and folder to watch

```sh
npx aemfed -t "http://admin:admin@localhost:4502" -e "**/*___jb_(old|tmp)___" -w "src/content/jcr_root/"
```

If you have a `package.json` in your project, add it as a script

```json
"scripts": {
    "aemfed": "aemfed -t \"http://admin:admin@localhost:4502\" -e \"**/*___jb_(old|tmp)___\" -w \"src/content/jcr_root/\""
}
```

...and run it with

```sh
npm run aemfed
```

Once started, connect your browser to the local access URL and port provided by BrowserSync, so you load the pages with the BrowserSync scripts and reloading and injecting is working without any other plugins.

## Requirements

- Works best with a recent version of node/npm, but tested with node 6.x
- Tested on AEM 6.1, 6.2, 6.3 and 6.4
- To be able to see the error messages from AEM, at least version 1.0.0 of the Sling Log Tracer is needed. AEM 6.2 and before have an older version or don't have the bundle at all. Versions of Log Tracer since 1.0.2 can also be installed on older versions of AEM (6.0+ according to the [ticket](https://issues.apache.org/jira/browse/SLING-5762)):
  - Download the latest Log Tracer bundle from the Sling downloads section (Sling Components > Log Tracer): [https://sling.apache.org/downloads.cgi](https://sling.apache.org/downloads.cgi)
  - If the latest version causes any trouble, download an older bundle from the Maven Repository: [https://mvnrepository.com/artifact/org.apache.sling/org.apache.sling.tracer](https://mvnrepository.com/artifact/org.apache.sling/org.apache.sling.tracer)

## Issues

- Using ~ (homedir) in paths to watch does not work as expected when aemfed does all the path processing (paths are surrounded with quotes)
- YUI minification generates errors for each request if there is an error (Less and GCC generate errors only first time after a resource was changed)
- When installing the [WKND tutorial](https://github.com/Adobe-Marketing-Cloud/aem-guides-wknd) in a clean AEM 6.3 SP2 or AEM 6.4, it is possible the changes pushed to AEM are not present in the final clientlibs loaded into the pages. Performing a one time clientlib rebuild could fix this: http://localhost:4502/libs/granite/ui/content/dumplibs.rebuild.html and click 'Invalidate Caches' & 'Rebuild Libraries' (last step can take up to 15 minutes)
- When inspecting Less imports to determine dependencies, very simple logic is used to process the file locations in the `@import`. Resulting in a number of edge cases not working as expected (and throw `ENOENT` exceptions):
  - Less variables are not supported in `@import` (used for example in the [WKND tutorial](https://github.com/Adobe-Marketing-Cloud/aem-guides-wknd) in `ui.apps/src/main/content/jcr_root/apps/wknd/clientlibs/clientlib-site/site/css/grid.less` to switch between the 6.3 and 6.4 `grid-base`). As a result changes in the imported file may not trigger an update in the browser
  - Importing css files in a Less file using `@import` doesn't work, since it appends `.less` to all `@imports`. But since the css probably doesn't need any Less processing anyway, it is better to include it directly in a css.txt (in older versions of AEM it also speeds up the Less processing)
- The issue, where BrowserSync was reloading all css when it could not find one of the patterns, is fixed with this version. Another issue is introduced however. When visiting the web console (`/system/console`) in Firefox, the links from the top menu stop working correctly. After one or two clicks it keeps redirecting you to the bundles page. This behaviour has not been seen in Chrome or Safari.

Thanks to the [BrowserSync](https://www.npmjs.com/package/browser-sync) team, to [gavoja](https://github.com/gavoja) for [aemsync](https://www.npmjs.com/package/aemsync) and [kevinweber](https://github.com/kevinweber) for [aem-front](https://www.npmjs.com/package/aem-front).
