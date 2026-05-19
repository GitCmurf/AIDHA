import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const rootDir = process.cwd();
const packagesDir = path.join(rootDir, "packages");

function getPackageJsonFiles(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    for (const file of list) {
        if (file === "node_modules") continue;
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat && stat.isDirectory()) {
            results = results.concat(getPackageJsonFiles(filePath));
        } else if (file === "package.json") {
            results.push(filePath);
        }
    }
    return results;
}

const packageJsons = getPackageJsonFiles(packagesDir);
let missing = 0;

for (const pj of packageJsons) {
    const content = JSON.parse(fs.readFileSync(pj, "utf-8"));
    const relativePath = path.relative(rootDir, pj);

    // Skip private root or packages that explicitly don't need tests if any
    if (content.name === "aidha" && pj === path.join(rootDir, "package.json")) continue;

    if (!content.scripts || !content.scripts["test:ci"]) {
        console.error(`Error: ${relativePath} is missing 'test:ci' script.`);
        missing++;
    }
}

if (missing > 0) {
    console.error(`\nFound ${missing} package(s) missing 'test:ci' script.`);
    process.exit(1);
} else {
    console.log("All packages have 'test:ci' script.");
}
