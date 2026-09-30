import fs from "node:fs";

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));

const version = pkg.version;

console.log(`Syncing project version to ${version}`);

// --------------------
// Cargo.toml
// --------------------

const cargoPath = "src-tauri/Cargo.toml";

let cargo = fs.readFileSync(cargoPath, "utf8");

cargo = cargo.replace(/^version = ".*"$/m, `version = "${version}"`);

fs.writeFileSync(cargoPath, cargo);

console.log(`Updated ${cargoPath}`);

// --------------------
// Cargo.lock
// --------------------

const cargoLockPath = "src-tauri/Cargo.lock";
let cargoLock = fs.readFileSync(cargoLockPath, "utf8");
const appPackageVersion = /(\[\[package\]\]\r?\nname = "sythoria"\r?\nversion = ")[^"]+(")/;

if (!appPackageVersion.test(cargoLock)) {
  throw new Error("Could not find the application version in Cargo.lock");
}

cargoLock = cargoLock.replace(
  appPackageVersion,
  (_match, prefix: string, suffix: string) => `${prefix}${version}${suffix}`,
);
fs.writeFileSync(cargoLockPath, cargoLock);
console.log(`Updated ${cargoLockPath}`);

// --------------------
// tauri.conf.json
// --------------------

const tauriPath = "src-tauri/tauri.conf.json";

const tauri = JSON.parse(fs.readFileSync(tauriPath, "utf8"));

tauri.version = version;

fs.writeFileSync(tauriPath, JSON.stringify(tauri, null, 2) + "\n");

console.log(`Updated ${tauriPath}`);

console.log("Done ✨");
