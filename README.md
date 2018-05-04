# aemfed

Speed up your AEM front-end development using [aemsync](https://www.npmjs.com/package/aemsync), [BrowserSync](https://www.npmjs.com/package/browser-sync) and [this](https://github.com/abmaonline/aemfed).

## Features

* Watches changes in files and uploads them to AEM using [aemsync](https://www.npmjs.com/package/aemsync)
* Determines which clientlibs are affected by the uploaded changes
* Runs [BrowserSync](https://www.npmjs.com/package/browser-sync) in proxy modus so it can communicate with all open instances of your site without any browser plugins. It reloads these pages when the changes have been uploaded, or it only injects the new styling when only styling changes were made, maintaining the state of the page.

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

When `npx` is not avialable, install it with

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

* Works best with a recent version of node/npm, but tested with node 6.x
* Tested on AEM 6.1 and 6.3

## Isues

* When sending a clientlib to BrowserSync that is not included in the page, all styling is reloaded. Issue in BrowserSync, will be fixed in future release: [#1505](https://github.com/BrowserSync/browser-sync/issues/1505)

Thanks to the [BrowserSync](https://www.npmjs.com/package/browser-sync) team, to [gavoja](https://github.com/gavoja) for [aemsync](https://www.npmjs.com/package/aemsync) and [kevinweber](https://github.com/kevinweber) for [aem-front](https://www.npmjs.com/package/aem-front).
