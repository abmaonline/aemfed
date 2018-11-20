((window, bs?: BrowserSyncClient) => {
  const PLUGIN_NAME = "QR Code";

  if (bs) {
    // Create shortcuts
    if (!bs.qr) {
      bs.qr = printQrCode;
    }
    if (!window.qr) {
      window.qr = printQrCode;
    }

    // Register for connection event
    const socket = bs.socket;
    socket.on("connection", options => {
      const pluginOptions = getPluginOptions(options);
      if (pluginOptions && pluginOptions.onload) {
        printQrCode();
      } else {
        console.log(
          `Show external QR code for current url using 'qr()' or '___browserSync___.qr()'`
        );
      }
    });

    // Print QR code function
    function printQrCode() {
      if (!window.qrcodeTerminal) {
        console.error("qrcode-terminal not yet loaded");
        return;
      }
      // Check if browsersync is available and build url, otherwise use current
      const href = getExternalUrl();
      qrcodeTerminal.generate(href, { small: true }, (qrcode: string) => {
        const styling = getLogStyling(navigator);
        console.log(`QR code for ${href}\n%c${qrcode}`, styling);
      });
    }

    function getExternalUrl() {
      return window.___browserSync___
        ? ___browserSync___.options.urls.external +
            location.pathname +
            location.search +
            location.hash
        : location.href;
    }

    function getLogStyling(navigator: Navigator) {
      const isSafari =
        /Safari/.test(navigator.userAgent) &&
        /Apple Computer, Inc/.test(navigator.vendor);
      const isEdge = /Edge/.test(navigator.userAgent) && !navigator.vendor;

      const baseStyling = "font-family: 'Courier New';";
      return (
        baseStyling +
        (isSafari ? " line-height: 1em;" : isEdge ? " line-height: 1.2em;" : "")
      );
    }

    function getPluginOptions(options: any): BsQrCode.IOptions | undefined {
      if (!options || !options.plugins || options.plugins.length === 0) {
        return;
      }

      function isPlugin(possiblePlugin: any) {
        const pluginName =
          possiblePlugin["plugin:name"] || possiblePlugin.module["plugin:name"];
        return pluginName === PLUGIN_NAME;
      }

      const plugin = options.plugins.find(isPlugin);

      // If the plugin was found, check first for the options object, otherwise return plugin itself
      if (plugin) {
        return plugin.options || plugin;
      }
    }
  }
})(window, window.___browserSync___);
