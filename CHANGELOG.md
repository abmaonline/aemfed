# aemfed changelog

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
