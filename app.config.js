// 開発用ビルド（APP_VARIANT=development）のときだけ、
// 本番のGlimpseと別のアプリとして入るように名前とアプリIDを変える。
const IS_DEV = process.env.APP_VARIANT === 'development';

module.exports = ({ config }) => ({
  ...config,
  name: IS_DEV ? 'Glimpse Dev' : config.name,
  ios: {
    ...config.ios,
    bundleIdentifier: IS_DEV
      ? 'com.totonowanaihibi.glimpse.dev'
      : config.ios.bundleIdentifier,
  },
});
