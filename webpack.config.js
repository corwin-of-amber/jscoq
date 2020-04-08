const path = require('path');

module.exports = {
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
};
