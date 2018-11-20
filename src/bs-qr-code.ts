import chalk from "chalk";
import { readFileSync } from "fs";

const PLUGIN_NAME = "QR Code";

const bsQrCode = {
  hooks: {
    "client:js":
      readFileSync(__dirname + "/../vendor/qrcode-terminal.js", "utf-8") +
      readFileSync(__dirname + "/client/bs-qr-code-client.js", "utf-8")
  },
  plugin: (options: BsQrCode.IOptions, bs: any) => {
    // Startup
    const logger = bs.getLogger(PLUGIN_NAME);

    bs.events.on("service:running", (data: any) => {
      logger.info(
        chalk`QR code of current url available in browser console using {cyan qr()} or {cyan ___browserSync___.qr()}`
      );
    });
  },
  "plugin:name": PLUGIN_NAME
};

// Use 'export =' here to be able to use an object for export (and use "plugin:name" as property)
// https://www.typescriptlang.org/docs/handbook/modules.html#export--and-import--require
export = bsQrCode;
