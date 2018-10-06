# aemfed

Speed up your AEM front-end development using [aemfed](https://aemfed.io). Powered by [aemsync](https://www.npmjs.com/package/aemsync), [Browsersync](https://www.npmjs.com/package/browser-sync) and [Sling Log Tracer](https://sling.apache.org/documentation/bundles/log-tracers.html).

[![Demo of aemfed changing some styling in the WKND project](https://user-images.githubusercontent.com/4146168/42420783-74cf2b58-82cb-11e8-8b36-15bcea9c621e.gif)](https://www.youtube.com/watch?v=sHIHSISOL0w)

> aemfed doing its thing: listening for file changes, uploading them to the running AEM instance, triggering a refresh of the styling in the browser, showing AEM error messages with a reference to the issue in the local file, all within a minute (disclaimer: this is a [special branch](https://github.com/abmaonline/aem-guides-wknd/tree/move-clientlibs-to-components) of the WKND project, optimized for the aemfed workflow).

## Features

- Watches changes in files and uploads them to AEM using [aemsync](https://www.npmjs.com/package/aemsync)
- Determines which clientlibs are affected by the uploaded changes
- Runs [Browsersync](https://www.npmjs.com/package/browser-sync) in proxy modus so it can communicate with all open instances of your site without any browser plugins. It reloads these pages when the changes have been uploaded, or it only injects the new styling when only styling changes were made, maintaining the state of the page.
- Show serverside errors related to clientlibs for each request (so no more digging in the error.log to see why your styling changes won't show up). It captures errors related to HTL templates, JSP files, Less compilation, Javascript minification (YUI and GCC), .content.xml, etc.
- If the error messages contain references to nodes in the jcr, it tries to translate them back to the files on your local file system, so you can navigate directly to the file, line and column mentioned in the error (if your IDE/shell supports the pattern).

## Installation

If you don't have a `package.json` (npm configuration file) for your project, you probably want to install aemfed globally:

```sh
npm install aemfed --global
```

If you do have a `package.json` for your project, you can add it as a dev dependency:

```sh
npm install aemfed --save-dev
```

## Usage

### Start with a global install

The following commands are for the global install option (used `--global`).

Show the available options:

```sh
aemfed -h
```

Run with specific server, ignore pattern (to ignore IntelliJ temp files) and folder to watch (at the moment this has to be the actual `jcr_root` folder for your project):

```sh
aemfed -t "http://admin:admin@localhost:4502" -e "**/*___jb_+(old|tmp)___" -w "ui.apps/src/main/content/jcr_root/"
```

### Start with a `package.json` install

The following commands are for a `package.json` install. Since `aemfed` is only available for this project and not globally, we can not use the `aemfed` command directly. You can use `npx` to run modules only available for a specific project.

Show the available options:

```sh
npx aemfed -h
```

When `npx` is not available, install it with:

```sh
npm install npx --global
```

Since you already have a `package.json` in your project, adding the startup command as a script is probably the easiest way to run aemfed (make sure the quotes in the command are escaped):

```json
"devDependencies": {
  "aemfed": "^0.0.5"
},
"scripts": {
    "aemfed": "aemfed -t \"http://admin:admin@localhost:4502\" -e \"**/*___jb_+(old|tmp)___\" -w \"ui.apps/src/main/content/jcr_root/\""
},
```

...and run it with

```sh
npm run aemfed
```

### Working with your codebase

Once started, the BrowserSync module will show the urls for the proxy that enables the auto reloading etc (when using aemfed these message use color, making them a lot clearer):

```
[Browsersync] Proxying: http://localhost:4502
[Browsersync] Access URLs:
 ------------------------------------
       Local: http://localhost:3000
    External: http://192.168.1.2:3000
 ------------------------------------
          UI: http://localhost:3001
 UI External: http://192.168.1.2:3001
 ------------------------------------
```

If you connect your browsers to the `Local` or `External` Access URL, the Browsersync reload script will be injected into the pages you visit, allowing aemfed to reload pages automatically after changes have been uploaded to AEM.

Navigate to the page you want to work on and make some changes to the clientlib files under the path provided during startup. When saving the file, aemfed reports the detected file changes:

```
ADD jcr_root/apps/wknd/components/content/list/clientlib/less/styles/default.less
```

...and uploads them to AEM:

```
  Deploying to [localhost:4502] in 39 ms at 2018-06-18T19:03:03.273Z: OK
```

When the upload is done, aemfed will determine which clientlibs need a reload. It also determines if a full reload of the page is needed (javascript, html, .content.xml) or if the changes can be injected w/o a complete reload (css and in the future probably static resources like images):

```
[localhost:4502] Only styling was changed, try to inject
[Browsersync] File event [change] : /apps/wknd/clientlibs/clientlib-base.css
[Browsersync] File event [change] : /apps/wknd/components/content/list/clientlib.css
```

If the changes can be injected, a list of all clientlibs that use the changed files is send to the listening browsers. The reloading script will determine which files are present in the current page and will refresh only those resources.

### Errors

When the correct version of the Sling Log Tracer is installed (see [Requirements](#requirements) for details), aemfed is able to intercept a number of the front-end related errors generated by AEM (Less, javascript, HTL, .content.xml, etc).

It shows the request that triggered the error:

```
[localhost:4502] Tracer output for [/etc.clientlibs/wknd/clientlibs/clientlib-base.css?browsersync=
1530965506424] (62c5e8ac-69e9-491c-8658-2bbed119d0c2)
```

...the error message itself:

```
[ERROR] LessCompilerImpl: failed to compile less /apps/wknd/components/content/list/clientlib/less/
list.less: NameError: variable @brand-secondary2 is undefined in /apps/wknd/components/content/list
/clientlib/less/styles/default.less on line 17, column 25:
16         &:hover {
17             background: @brand-secondary2;
18         }
```

...and an attempt to map the location in the error back to the local development environment:

```
Local source: ui.apps/src/main/content/jcr_root/apps/wknd/components/content/list/clientlib/less/st
yles/default.less:17:25
```

Most of these errors show up only once after the file has been changed, since AEM caches the result, so its best to keep the aemfed terminal always in clear view (using the terminal in your IDE is a good way to make sure this is the case).

The `Local source:` line in the output, is aemfed's attempt to translate the AEM error location back to the local file, line and column. So locating the issue becomes much easier. Some IDE's and shells even recognize the pattern and turn it into a link, to make your life even easier.

## Requirements

- Works best with a recent version of node/npm, but tested with node 6.x
- Tested on AEM 6.1, 6.2, 6.3 and 6.4
- To be able to see the error messages from AEM, at least version 1.0.0 of the Sling Log Tracer is needed. AEM 6.2 and before have an older version or don't have the bundle at all. Versions of Log Tracer since 1.0.2 can also be installed on those older versions of AEM (6.0+ according to the [ticket](https://issues.apache.org/jira/browse/SLING-5762)). See [Updating Sling Log Tracer](#updating-sling-log-tracer) for instructions.

### Updating Sling Log Tracer

1.  Check the current version of your Sling Log Tracer at `/system/console/bundles/org.apache.sling.tracer` on the instance you're using. If it is 1.0.0 or newer you are good. If it is 0.0.2 or the bundle is not found at all, you need to install a newer version:
2.  Download the latest Log Tracer bundle from the Sling downloads section (Sling Components > Log Tracer): [https://sling.apache.org/downloads.cgi](https://sling.apache.org/downloads.cgi)
    - If the latest version causes any trouble, download an older bundle from the Maven Repository: [https://mvnrepository.com/artifact/org.apache.sling/org.apache.sling.tracer](https://mvnrepository.com/artifact/org.apache.sling/org.apache.sling.tracer)
3.  Go to `/system/console/bundles` on the instance you want to update and click `Install/Update...` in the top right corner
4.  Check `Start Bundle` and `Refresh Packages`, browse for the package downloaded in step 2 and click `Install or Update`
5.  Check if the install was successful by checking the version number again: `/system/console/bundles/org.apache.sling.tracer`
6.  Enable the Log Tracer by checking `Enabled` and `Recording Servlet Enabled` in the Tracer configuration: `/system/console/configMgr/org.apache.sling.tracer.internal.LogTracer`
7.  Test if the tracer is working, for example by using a non-existent variable in your Less, saving the file and making sure the page including the clietlib with the Less file is reloaded (since the clientlib errors are only triggered on a rebuild and a rebuild is only triggered when a page that uses the clientlib is requested again)

## Issues

- aemsync does not respect your projects `filter.xml`, so please be very careful when removing high level items when running aemfed. Changes to root nodes like `/apps`, `/content` and `/etc` are skipped, but when you remove `/etc/clientlibs` from your project (for example after you moved all your clientlibs to proxies in `/apps`) it does exactly that...
- Using ~ (homedir) in paths to watch does not work as expected when aemfed does all the path processing (paths are surrounded with quotes)
- YUI minification generates errors for each request if there is an error (Less and GCC generate errors only first time after a resource was changed)
- When installing the [WKND tutorial](https://github.com/Adobe-Marketing-Cloud/aem-guides-wknd) in a clean AEM 6.3 SP2 or AEM 6.4, it is possible the changes pushed to AEM are not present in the final clientlibs loaded into the pages. Performing a one time clientlib rebuild could fix this: http://localhost:4502/libs/granite/ui/content/dumplibs.rebuild.html and click 'Invalidate Caches' & 'Rebuild Libraries' (last step can take up to 15 minutes)
- When inspecting Less imports to determine dependencies, very simple logic is used to process the file locations in the `@import`. Resulting in a number of edge cases not working as expected (and throw `ENOENT` exceptions):
  - Less variables are not supported in `@import` (used for example in the [WKND tutorial](https://github.com/Adobe-Marketing-Cloud/aem-guides-wknd) in `ui.apps/src/main/content/jcr_root/apps/wknd/clientlibs/clientlib-site/site/css/grid.less` to switch between the 6.3 and 6.4 `grid-base`). As a result changes in the imported file may not trigger an update in the browser
  - Importing css files in a Less file using `@import` doesn't work, since it appends `.less` to all `@imports`. But since the css probably doesn't need any Less processing anyway, it is better to include it directly in a css.txt (in older versions of AEM it also speeds up the Less processing)
- The new log processing code is all over the place, needs it own module(s).

Thanks to the [Browsersync](https://www.npmjs.com/package/browser-sync) team, to [gavoja](https://github.com/gavoja) for [aemsync](https://www.npmjs.com/package/aemsync) and [kevinweber](https://github.com/kevinweber) for [aem-front](https://www.npmjs.com/package/aem-front).
