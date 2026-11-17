// Сборка: вставляет src/core.js и src/help.js в src/app.html -> dist/index.html
const fs = require('fs');
const path = require('path');
const src = (f) => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
const out = src('app.html')
  .replace('/*DND5E*/', () => src('dnd5e-data.js'))
  .replace('/*CORE*/', () => src('core.js'))
  .replace('/*HELP*/', () => src('help.js'))
  .replace('/*GURPS*/', () => src('gurps-data.js'))
  .replace('/*TABLE*/', () => src('table.js'))
  .replace('/*NET*/', () => src('net.js'))
  .replace('/*TIPS*/', () => src('tips.js'))
  .replace('/*TABLEUI*/', () => src('table-ui.js'));
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist', 'index.html'), out);
console.log('dist/index.html', out.length, 'байт');
