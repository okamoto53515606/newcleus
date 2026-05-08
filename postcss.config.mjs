/**
 * PostCSS 設定
 *
 * why: Tailwind CSS v4 は @tailwindcss/postcss プラグイン経由で動作する。
 *      tailwind.config.js は v4 では不要（CSS ファイルの @import で設定する）。
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
