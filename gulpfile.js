const { src, dest } = require('gulp');

// Copies node icons (svg/png) and codex metadata (*.node.json) into the dist
// tree, preserving folder layout, so n8n can resolve `icon: 'file:...'` and the
// node's codex file at runtime.
function buildIcons() {
  return src('nodes/**/*.{png,svg,json}', { base: '.' }).pipe(dest('dist'));
}

exports['build:icons'] = buildIcons;
exports.default = buildIcons;
