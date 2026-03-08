const fs = require('fs');
const path = require('path');

const mainPath = path.join(__dirname, 'src', 'main.ts');
let content = fs.readFileSync(mainPath, 'utf8');

const searchStr = "import { startApiServer, stopApiServer, API_PORT } from './api-server';";
const replaceStr = "import { startApiServer, stopApiServer, API_PORT } from './api-server';\nimport { initUpdater } from './updater';";

if (!content.includes("import { initUpdater }")) {
    content = content.replace(searchStr, replaceStr);
    fs.writeFileSync(mainPath, content, 'utf8');
    console.log('✓ Added initUpdater import');
} else {
    console.log('✓ initUpdater import already exists');
}
