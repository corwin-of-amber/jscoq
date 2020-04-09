const path = require('path');

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
  node: false
}
];
