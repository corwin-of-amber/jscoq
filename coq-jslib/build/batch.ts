import { EventEmitter } from 'events';
import { FSInterface } from './fsif';
import { SearchPathElement, CoqProject, InMemoryVolume, JsCoqCompat } from './project';



abstract class Batch {

    volume: FSInterface = null;

    abstract command(cmd: any[]): void;
    abstract expect(yes: (msg: any[]) => boolean,
                    no?: (msg: any[]) => boolean): Promise<any[]>;

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


class BatchWorker extends Batch {

    worker: Worker

    constructor(worker: Worker) {
        super();
        this.worker = worker;
    }

    command(cmd: any[]) {
        this.worker.postMessage(cmd);
    }

    expect(yes: (msg: any[]) => boolean,
           no:  (msg: any[]) => boolean = m => this.isError(m)) {
        const worker = this.worker;
        return new Promise<any[]>((resolve, reject) => {
            function h(ev: {data: any[]}) {
                if (yes(ev.data))       { cleanup(); resolve(ev.data); }
                else if (no(ev.data))   { cleanup(); reject(ev.data); }
            }
            worker.addEventListener('message', h);
            function cleanup() { worker.removeEventListener('message', h); }
        });
    }    

}


class CompileTask extends EventEmitter{

    batch: Batch
    inproj: CoqProject
    outproj: CoqProject
    infiles: SearchPathElement[] = [];
    outfiles: SearchPathElement[] = [];
    volume: FSInterface

    opts: CompileTaskOptions

    _stop = false;

    constructor(batch: Batch, inproj: CoqProject, opts: CompileTaskOptions = {}) {
        super();
        this.batch = batch;
        this.inproj = inproj;
        this.opts = opts;

        this.volume = batch.volume || new InMemoryVolume();
    }

    async run(outname?: string) {
        if (this._stop) return;

        var coqdep = this.inproj.computeDeps(),
            plan = coqdep.buildOrder();

        await this.loadPackages(coqdep.extern);

        for (let mod of plan) {
            if (this._stop) break;
            if (mod.physical.endsWith('.v'))
                await this.compile(mod);
        }
    
        return this.output(outname);
    }

    async loadPackages(pkgs: Set<string>) {
        if (pkgs.size > 0)
            await this.batch.do(
                ['LoadPkg', [...pkgs].map(pkg => `+${pkg}`)],
                msg => msg[0] == 'LoadedPkg'
            );
    }

    async compile(mod: SearchPathElement, opts=this.opts) {
        var {volume, logical, physical} = mod,
            infn = `/lib/${logical.join('/')}.v`, outfn = `${infn}o`;
        this.infiles.push(mod);

        this.emit('progress', [{filename: physical, status: 'compiling'}]);

        try {
            await this.batch.do(
                ['Init', {top_name: logical.join('.')}],
                ['Put', infn, volume.fs.readFileSync(physical)],
                ['Load', infn],            msg => msg[0] == 'Loaded',
                ['Compile', outfn],        msg => msg[0] == 'Compiled');

            if (!this.batch.volume) {
                let [[, , vo]] = await this.batch.do(
                    ['Get', outfn],        msg => msg[0] == 'Got');            
                this.volume.fs.writeFileSync(outfn, vo);
            }

            this.outfiles.push({volume: this.volume, 
                                logical, physical: outfn});

            this.emit('progress', [{filename: physical, status: 'compiled'}]);
        }
        catch (e) {
            this.emit('report', e);
            this.emit('progress', [{filename: physical, status: 'error'}]);
            throw e;
        }
    }

    stop() { this._stop = true; }

    output(name?: string) {
        this.outproj = new CoqProject(name || this.inproj.name || 'out',
                                      this.volume);
        for (let mod of this.outfiles) mod.pkg = this.outproj.name;
        this.outproj.searchPath.addRecursive({physical: '/lib', logical: []});
        this.outproj.setModules(this._files());
        return this.outproj;
    }
        
    toPackage(filename?: string, extensions?: string[]) {
        return this.outproj.toPackage(filename, extensions,
            this.opts.jscoq ? JsCoqCompat.transpilePluginsJs : undefined,
            this.opts.jscoq ? JsCoqCompat.backportManifest : undefined);
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



export { Batch, BatchWorker, CompileTask, CompileTaskOptions, BuildError }
