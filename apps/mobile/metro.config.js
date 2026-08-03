const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);
const bridgeRoot = path.resolve(__dirname, '..', '..', 'packages', 'mobile-editor-bridge');
config.watchFolders = [path.resolve(__dirname, '..', '..'), bridgeRoot];
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver = {
  ...config.resolver,
  extraNodeModules: {
    ...(config.resolver.extraNodeModules || {}),
    '@ledger/mobile-editor-bridge': bridgeRoot,
  },
  resolveRequest: (context, moduleName, platform) => {
    if (moduleName === '@ledger/mobile-editor-bridge' || moduleName.startsWith('@ledger/mobile-editor-bridge/')) {
      const suffix = moduleName === '@ledger/mobile-editor-bridge' ? 'index' : moduleName.slice('@ledger/mobile-editor-bridge/'.length);
      return { type: 'sourceFile', filePath: path.join(bridgeRoot, `${suffix}.ts`) };
    }
    return defaultResolveRequest ? defaultResolveRequest(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform);
  },
};

const { transformer, resolver } = config;

config.transformer = {
  ...transformer,
  babelTransformerPath: require.resolve('react-native-svg-transformer'),
};

config.resolver = {
  ...resolver,
  assetExts: [...resolver.assetExts.filter((ext) => ext !== 'svg'), 'html'],
  sourceExts: [...resolver.sourceExts, 'svg'],
};

module.exports = config;
