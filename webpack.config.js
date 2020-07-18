const path = require('path');
const webpack = require('webpack');

module.exports = [
{
  name: 'cli',
  target: 'node',
  entry: './coq-jslib/cli.ts',
  mode: 'development',
  devtool: "source-map",
  stats: {
    hash: false, version: false, modules: false  // reduce verbosity
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
},
{
  name: 'ide-project',
  mode: 'development',
  entry: './ui-js/ide-project.js',
  output: {
    filename: 'ide-project.browser.js',
    path: path.resolve(__dirname, '_build/jscoq+64bit/ui-js'),
    library: 'ideProject',
    libraryTarget: 'umd'
  },
  node: {
    fs: 'empty'
  },
  /* boilerplate for typescript */
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
      {
        test: /\.s?css$/i,
        use: ['style-loader', 'css-loader', 'sass-loader'],
      },
      {
        test: /\.(png|jpe?g|gif)$/i,
        use: ['file-loader']
      }
    ],
  },
  resolve: {
    extensions: [ '.tsx', '.ts', '.js' ],
  }
}
];
