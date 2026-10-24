const { merge } = require('webpack-merge');
const common = require('./webpack.common.js');

module.exports = merge(common, {
    mode: 'development',
    devtool: 'inline-source-map',
    devServer: {
        // progress: true,
        liveReload: false,
        static: {
            directory: require('path').join(__dirname, '.'),
        },
    },
});