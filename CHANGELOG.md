# aemfed changelog

## 0.0.1

### Initial release

* Use aemsync and BrowserSync
* Build and update dependency tree for individual clientlibs in watched folders
* Build and update dependency tree for clientlib aggregation in AEM
* Use both trees to determine which clientlibs in the active page were affected by the file changes uploaded by aemsync and determine the best BrowserSync refresh method. Inject if only styling changes (and maintain the state of the page) and reload if anything else was changed (html, javascript, clientlib structure)
