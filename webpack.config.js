/* eslint-disable no-undef */
const path = require("path");
const webpack = require("webpack");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const devCerts = require("office-addin-dev-certs");
const pkg = require("./package.json");

const urlDev = "https://localhost:3000/";
// The live GitHub Pages host the deployed add-in is served from. Used to stamp
// the published manifest so /manifest.xml is directly installable (and matches
// what the install packs ship). No trailing slash — it prefixes "/taskpane.html"
// etc. and replaces the manifest's placeholder host verbatim.
const prodHost = "https://alexsmi22-dotcom.github.io/MS-WORD-Add-in";

async function getHttpsOptions() {
  const httpsOptions = await devCerts.getHttpsServerOptions();
  return { ca: httpsOptions.ca, key: httpsOptions.key, cert: httpsOptions.cert };
}

module.exports = async (env, options) => {
  const dev = options.mode === "development";

  const config = {
    devtool: "source-map",
    entry: {
      taskpane: ["./src/taskpane/taskpane.ts"],
      commands: ["./src/commands/commands.ts"],
      drawdialog: ["./src/drawdialog/drawdialog.ts"],
      solvedialog: ["./src/solvedialog/solvedialog.ts"],
    },
    output: {
      clean: true,
      path: path.resolve(__dirname, "dist"),
      // Content-hash the emitted JS in production so every deploy is a new URL
      // Office/WebView2 has never cached — otherwise the aggressively-cached
      // `taskpane.js` keeps serving a stale bundle after an update. The HTML
      // filenames stay fixed (the manifest points at them); HtmlWebpackPlugin
      // injects the hashed script names into them automatically.
      filename: dev ? "[name].js" : "[name].[contenthash].js",
    },
    resolve: {
      extensions: [".ts", ".js", ".html"],
      // Every `import ... from "openchemlib"` resolves to the FULL build — the
      // only one that ships CanvasEditor (the interactive drawing surface).
      // Aliasing here (rather than changing 27 import sites) also guarantees a
      // single OCL copy in the bundle; mixing core and full would double it.
      alias: { openchemlib$: path.resolve(__dirname, "node_modules/openchemlib/full.js") },
      // PptxGenJS references Node builtins on its (unused) Node code paths;
      // stub them out for the browser bundle.
      fallback: { fs: false, https: false, os: false, path: false },
    },
    // The OpenChemLib core bundle is large but is served locally to the add-in,
    // so the default web-performance size budget doesn't apply here.
    performance: {
      hints: false,
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          use: "ts-loader",
          exclude: /node_modules/,
        },
        {
          test: /\.html$/,
          use: "html-loader",
        },
        {
          test: /\.(png|jpg|jpeg|gif|ico)$/,
          type: "asset/resource",
          generator: { filename: "assets/[name][ext][query]" },
        },
      ],
    },
    plugins: [
      // Webpack doesn't resolve the "node:" URI scheme for web targets — strip
      // it so the imports above hit the resolve.fallback stubs instead.
      new webpack.NormalModuleReplacementPlugin(/^node:/, (resource) => {
        resource.request = resource.request.replace(/^node:/, "");
      }),
      // Bake the build version into the bundle so the pane can compare itself to
      // the hosted version.json and prompt users to reload after a new release.
      new webpack.DefinePlugin({
        __APP_VERSION__: JSON.stringify(pkg.version),
      }),
      // Emit /version.json (the update check fetches it cache-busted at runtime).
      {
        apply(compiler) {
          compiler.hooks.thisCompilation.tap("EmitVersion", (compilation) => {
            compilation.hooks.processAssets.tap(
              { name: "EmitVersion", stage: webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL },
              () => {
                compilation.emitAsset(
                  "version.json",
                  new webpack.sources.RawSource(JSON.stringify({ version: pkg.version })),
                );
              },
            );
          });
        },
      },
      new HtmlWebpackPlugin({
        filename: "taskpane.html",
        template: "./src/taskpane/taskpane.html",
        chunks: ["taskpane"],
      }),
      new HtmlWebpackPlugin({
        filename: "commands.html",
        template: "./src/commands/commands.html",
        chunks: ["commands"],
      }),
      new HtmlWebpackPlugin({
        filename: "drawdialog.html",
        template: "./src/drawdialog/drawdialog.html",
        chunks: ["drawdialog"],
      }),
      new HtmlWebpackPlugin({
        filename: "solvedialog.html",
        template: "./src/solvedialog/solvedialog.html",
        chunks: ["solvedialog"],
      }),
      new CopyWebpackPlugin({
        patterns: [
          { from: "assets/*", to: "assets/[name][ext][query]" },
          // Publish a single installable manifest at the site root. In production,
          // stamp the production manifest with the live Pages host so the deployed
          // /manifest.xml points at the hosted files and matches what the install
          // packs ship; in dev, publish the localhost manifest for local sideload.
          // (The example.com template and the localhost dev manifest are NOT
          // published in production — a new user grabbing /manifest.xml gets a
          // working one, not a dev URL.)
          dev
            ? { from: "manifest.xml", to: "manifest.xml" }
            : {
                from: "manifest.prod.xml",
                to: "manifest.xml",
                transform: (content) =>
                  content.toString().replace(/https:\/\/ADDIN-HOST\.example\.com/g, prodHost),
              },
          // Globbed, not listed. These five were named individually, so authoring a
          // sixth page produced a file that every QC gate checked (they glob
          // landing/) and that webpack then never copied — a link straight to a 404
          // with nothing failing. Adding a page to landing/ now publishes it.
          { from: "landing/*.html", to: "[name][ext]" },
        ],
      }),
    ],
    devServer: {
      headers: { "Access-Control-Allow-Origin": "*" },
      server: {
        type: "https",
        options: env.WEBPACK_BUILD || options.https !== undefined ? options.https : await getHttpsOptions(),
      },
      port: 3000,
    },
  };

  return config;
};
