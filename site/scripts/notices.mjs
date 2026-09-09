import {readFile,writeFile,mkdir} from 'node:fs/promises';
const notices=await Promise.all([
  readFile('node_modules/@fontsource-variable/manrope/LICENSE','utf8'),
  readFile('node_modules/lucide/LICENSE','utf8')
]);
await mkdir('public',{recursive:true});
await writeFile('public/credits.txt',`Chirpberry website\n\nOriginal code and artwork: MIT License.\n\nManrope / Fontsource\n${notices[0]}\n\nLucide\n${notices[1]}\n`);
