import fs from 'fs';
import path from 'path';

type FSInterface = {
    fs: typeof fs
    path: typeof path
}


function tryRequireNode(mod: string) {
    try {
        return require(mod);
    }
    catch { return {}; }
}

const fsif_native = {
    fs: tryRequireNode('fs'),
    path: require('path')
};



export { FSInterface, fsif_native }
