import fs from 'fs';
import path from 'node:path';
import fsp from 'fs/promises';

export const readAll = async (dir: string) => fsp.readdir(path.resolve(fs.realpathSync(dir)));
