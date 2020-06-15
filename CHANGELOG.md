# aemfed changelog

## 0.1.2-rc.0

- Probably the last version to support Node.js 6. This version of Node.js is EoL for over a year, a lot of libraries we use dropped support and almost no one uses it anyway
- Updated dependencies to fix a number of security warnings ([#22](https://github.com/abmaonline/aemfed/pull/22) by [jegli](https://github.com/jegli))
- Moved customized dependencies to their own scoped npm packages, instead of github tarballs, to make integration in development workflows easier and reduce errors from old `.npmrc` files
- Create clearer log messages during startup ([#9](https://github.com/abmaonline/aemfed/pull/9) by [ryanholder](https://github.com/ryanholder))

## 0.1.1

- Updated dependencies to fix a number of security warnings

## 0.1.0

- Add Windows support for all features. (Running a global or `npx` install in PowerShell has some limitations, see the Issues section in the [README.md](README.md#issues) for more details)
- When aemfed mentions an update is available and it is part of your `package.json`, the command presented to perform the update will have no effect. This is because the version numbers are still < 1.0.0, so the default update behavior is more conservative (see [npm-semver - Caret Ranges ^1.2.3 ^0.2.5 ^0.0.4](https://docs.npmjs.com/misc/semver#caret-ranges-123-025-004) for more details). Run `npm i aemfed@latest` to force an update anyway. For global installs this shouldn't be an issue
- Updated dependencies

## 0.0.8

- QR code support in the browser console. Type `qr()` in the console of browsers connected to aemfed, to get an ASCII-art QR code with the active url in it, for easier synchronisation with mobile devices. At the moment uses an ES6 target (just as the rest of the project), so IE11 and earlier are not supported
- Add an npm-style version check, that checks once a day if a newer version of aemfed has been pushed to npm. Since aemfed is likely to be installed global, automated options to check for updates are limited. This option should help with that
- Fixes the `-b` browser startup argument
- Explicitly specify node 6.14.4 LTS as the oldest supported version in `package.json` and pin the accompanying TypeScript definition
- Updated dependencies

## 0.0.7

- Use tarballs to reference customized dependencies to speed up `npm install` and fix an issue when npm is trying to use ssh to get the reference
- Updated dependencies

## 0.0.6

### Error logging improvements

- Add support for error logging in JSP files
- Add initial error log support for json requests
- Add more types of Sightly errors for requests (messages are limited since the stacktrace is missing)
- Show only the first message in case of repeating, nested exception messages (HTL/JSP)
- Use absolute path for local file reference, since not all environments understand paths relative to project folder
- Show HTL/JSP errors, even when there are no actual exceptions in the request

### Other

- Use the css browser cache buster also for javascript, to prevent caching issues in case no [Versioned Clientlibs](https://adobe-consulting-services.github.io/acs-aem-commons/features/versioned-clientlibs/index.html) are used
- Updated dependencies
  - Browsersync 2.26.0 fixes the issue preventing navigation in Firefox: [#1570](https://github.com/BrowserSync/browser-sync/issues/1570)
  - aemsync ignore pattern module was updated, so check if yours is still working

## 0.0.5

### Error logging improvements

- Capture HTL errors (relevant message is not part of normal log tracer logs)
- Support a number of functions for each logger to process received log messages, for example to clean yui message or to extract and references to jcr nodes
- Extract references to jcr nodes in errors and convert them to references to the files on the files system. So if the IDE or shell understands the pattern ([file-path]:[line-nr]:[column-nr]) it can be used to directly navigate to the file, line number and column being referenced in the error. This works for:
  - HTL
  - Less
  - Javascript, if it is processed by YUI or GCC
  - .content.xml
- Update Log Tracer version detection and add documentation about installing/updating to a compatible version for AEM 6.2 and before

### Other

- Update aemsync, BrowserSync and TypeScript

## 0.0.4

- Update BrowserSync to fix issue with reloading all css [#1505](https://github.com/BrowserSync/browser-sync/issues/1505). It introduces a problem with Firefix and the web console however.
- Add option to specify start port for BrowserSync proxy, so it is easier to run multiple versions at the same time

## 0.0.3

- Fix exception when specific files or a directory were removed

## 0.0.2

### Proxy multiple targets

- Initial support for proxying all provided targets
- Each target maintains and updates its own dumplibs clientlib tree
- Prefix log messages with target name
- BrowserSync proxy ports start at default (3000) and increase by two (proxy + ui) for each provided target, in same order as targets on command line

### Integrate clientlib error logging

- Show clientlib related errors for a request in console using Sling log tracers. It shows serverside errors for Less compilation and minification using the YUI and GCC
- Read and store OSGi config to see if tracers are enabled and show instructions on how to enable on dev

### Other

- Add browsersync cache buster also on initial requests to stop using cached code on reload and make styling injection smoother on Firefox
- Update several dependencies and rewrite for new aemsync 3.0 structure using Pipeline
- Use patched version of aemsync to fix package manager clutter

## 0.0.1

### Initial release

- Use aemsync and BrowserSync
- Build and update dependency tree for individual clientlibs in watched folders
- Build and update dependency tree for clientlib aggregation in AEM
- Use both trees to determine which clientlibs in the active page were affected by the file changes uploaded by aemsync and determine the best BrowserSync refresh method. Inject if only styling changes (and maintain the state of the page) and reload if anything else was changed (html, javascript, clientlib structure)
