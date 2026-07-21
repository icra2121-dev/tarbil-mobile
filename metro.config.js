const { getDefaultConfig } = require("expo/metro-config");
const exclusionList = require("metro-config/private/defaults/exclusionList").default;
const path = require("path");

const config = getDefaultConfig(__dirname);

function escapeForRegExp(value) {
  return value.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
}

function rootEntry(name, includeChildren = false) {
  const entryPath = path.join(__dirname, name);
  const pattern = entryPath.split(/[\\/]/).map(escapeForRegExp).join("[/\\\\]");
  return new RegExp(`^${pattern}${includeChildren ? "([/\\\\].*)?" : ""}$`);
}

config.resolver.blockList = exclusionList([
  rootEntry(".codex-docx-render", true),
  rootEntry(".git", true),
  rootEntry(".idea", true),
  rootEntry(".vscode", true),
  rootEntry("android", true),
  rootEntry("dist", true),
]);

module.exports = config;
