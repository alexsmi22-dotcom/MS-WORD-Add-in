/* eslint-disable no-undef */
const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const devCerts = require("office-addin-dev-certs");

const urlDev = "https://localhost:3000/";

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
    },
    output: {
      clean: true,
      path: path.resolve(__dirname, "dist"),
      filename: "[name].js",
    },
    resolve: {
      extensions: [".ts", ".js", ".html"],
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
      new CopyWebpackPlugin({
        patterns: [
          { from: "assets/*", to: "assets/[name][ext][query]" },
          { from: "manifest*.xml", to: "[name][ext]" },
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
