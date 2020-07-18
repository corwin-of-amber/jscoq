const webpack = require('webpack');

module.exports = {
  name: 'cli',
  target: 'node',
  entry: './coq-jslib/cli.ts',
  mode: 'development',
  devtool: "source-map",
  stats: {
    hash: false, version: false, modules: false  // reduce verbosity
  },
  /* boilerplate for typescript */
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: [ '.tsx', '.ts', '.js' ],
  },
  output: {
    filename: 'cli.js',
    path: __dirname   // should be run by Dune in _build/*
  },
  plugins: [
    new webpack.BannerPlugin({banner: '#!/usr/bin/env node', raw: true}),
    new webpack.optimize.LimitChunkCountPlugin({maxChunks: 1})
  ],
  node: false
};
