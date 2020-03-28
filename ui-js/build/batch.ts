import { EventEmitter } from 'events';
import { SearchPathElement, CoqProject, InMemoryVolume } from './project';



class BatchWorker {

    worker: Worker

    constructor(worker: Worker) {
        this.worker = worker;
    }

    expect(yes: (msg: any[]) => boolean,
           no:  (msg: any[]) => boolean = m => this.isError(m)) {
        const worker = this.worker;
        return new Promise((resolve, reject) => {
            function h(ev: any) {
                if (yes(ev.data))       { cleanup(); resolve(ev.data); }
                else if (no(ev.data))   { cleanup(); reject(ev.data); }
            }
            worker.addEventListener('message', h);
            function cleanup() { worker.removeEventListener('message', h); }
        });
    }    

    command(cmd: any[]) {
        this.worker.postMessage(cmd);
    }

    async do(...actions: (any[] | ((msg: any[]) => boolean))[]) {
        var replies = [];

        for (let action of actions)
            if (typeof action === 'function')
                replies.push(await this.expect(action));
            else this.command(action);

        return replies;
    }

    isError(msg: any[]) {
        return ['JsonExn', 'CoqExn'].includes(msg[0]);
    }

}


class CompileTask extends EventEmitter{

    batch: BatchWorker
    inproj: CoqProject
    outproj: CoqProject
    infiles: SearchPathElement[] = []
    outfiles: SearchPathElement[] = []

    opts: CompileTaskOptions

    constructor(batch: BatchWorker, inproj: CoqProject, opts: CompileTaskOptions = {}) {
        super();
        this.batch = batch;
        this.inproj = inproj;
        this.opts = opts;

        this.outproj = new CoqProject(inproj.name || 'out', new InMemoryVolume());
    }

    async run(outname?: string) {
        var plan = this.inproj.computeDeps().buildOrder();

        for (let mod of plan) {
            console.log(mod.physical);
            if (mod.physical.endsWith('.v'))
                await this.compile(mod);
        }
    
        return this.output(outname);
    }

    async compile(mod: SearchPathElement, opts=this.opts) {
        var {volume, logical, physical} = mod,
            infn = `/lib/${logical.join('/')}.v`, outfn = `${infn}o`;
        this.infiles.push(mod);

        this.emit('progress', [{filename: physical, status: 'compiling'}]);

        try {
            let [, , [, , vo]] = await this.batch.do(
                ['Init', {top_name: logical.join('.')}],
                ['Put', infn, volume.fs.readFileSync(physical)],
                ['Load', infn],            msg => msg[0] == 'Loaded',
                ['Compile', outfn],        msg => msg[0] == 'Compiled',
                ['Get', outfn],            msg => msg[0] == 'Got');
            
            this.outproj.volume.fs.writeFileSync(outfn, vo);
            this.outfiles.push({volume: this.outproj.volume, 
                                logical, physical: outfn});

            this.emit('progress', [{filename: physical, status: 'compiled'}]);
        }
        catch (e) {
            this.emit('report', e);
            this.emit('progress', [{filename: physical, status: 'error'}]);
            throw e;
        }
    }

    output(name?: string) {
        if (name) this.outproj.name = name;
        for (let mod of this.outfiles) mod.pkg = this.outproj.name;
        this.outproj.searchPath.addRecursive({physical: '/lib', logical: []});
        this.outproj.setModules(this._files());
        return this.outproj;
    }
        
    toPackage() {
        return this.outproj.toPackage(undefined,
            this.opts.jscoq ? CoqProject.backportToJsCoq : undefined);
    }

    _files(): SearchPathElement[] {
        return [].concat(this.infiles, this.outfiles);
    }

}

type CompileTaskOptions = {
    continue?: boolean
    jscoq?: boolean
};


class BuildError { }



export { BatchWorker, CompileTask, CompileTaskOptions, BuildError }
