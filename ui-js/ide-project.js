// Build with
//  parcel watch ui-js/ide-project.js -d _build/jscoq+64bit/ui-js -o ide-project.browser.js --global ideProject

import Vue from 'vue/dist/vue';
import { BatchWorker, CompileTask } from './build/batch';
import { CoqProject, InMemoryVolume, ZipVolume } from './build/project';



Object.assign(window, {CoqProject, InMemoryVolume, ZipVolume})


class ProjectPanel {

    constructor(el) {
        require('./components/file-list');
        require('./components/problem-list');

        el = el || this._createDOM();

        this.view = new Vue({
            el: el,
            data: {
                files: [],
                status: {},
                root: []
            }
        });
        
        this.view.$watch('files', v => this._update(v, this.view.status));
        this.view.$watch('status', v => this._update(this.view.files, v), {deep: true});
        this.view.$on('action', ev => this.onAction(ev));
        this.view.$on('new', () => this.clear());
        this.view.$on('build', () => this.build()
            .catch(e => { if (e[0] != 'CoqExn') throw e; }));
        this.view.$on('download', () => this.download());

        this.editor_provider = undefined;
    }

    get $el() { return this.view.$el; }

    clear() {
        this.project = null;
        this.view.root = [];
        this.view.files = [];
        this.view.status = {};
    }

    open(project) {
        this.project = project;
        this.view.root = [];
        this.view.files = [...project.modulesByExt('.v')]
                          .map(mod => mod.physical);
        this.view.status = {};

        this.report = new BuildReport(this.project);
        this.report.editor = this.editor_provider;

        if (this.editor_provider) this._associateStore();
    }

    async openZip(zip, filename=undefined) {
        let vol = (zip instanceof Promise || zip instanceof Blob) ?
                    await ZipVolume.fromBlob(zip)
                  : new ZipVolume(zip);
        this.open(new CoqProject(filename.replace(/[.]zip$/, ''), vol)
                  .fromDirectory('').copyLogical(new LogicalVolume()));
    }

    async openDirectory(entries /* (File | FileEntry | DirectoryEntry)[] */) {
        let vol = new LogicalVolume();
        for (let entry of entries) {
            await vol.fromWebKitEntry(entry);
        }
        let name = entries.length == 1 ? entries[0].name : undefined;
        this.open(new CoqProject(name, vol).fromDirectory('/'));
    }

    withEditor(editor_provider /* CmCoqProvider */) {
        this.editor_provider = editor_provider;
        if (this.project) this._associateStore();
        if (this.report) this.report.editor = this.editor_provider;
        return this;
    }

    async build(coq) {
        this.view.status = {};
        this.report.clear();

        if (this.editor_provider.dirty) this.editor_provider.saveLocal();

        coq = coq || new CoqWorker();
        await coq.when_created;

        var task = new CompileTask(new BatchWorker(coq.worker), this.project);
        task.on('progress', files => this._progress(files));
        task.on('report', e => this.report.add(e));
        return this.out = await task.run();
    }

    async download() {
        var fn, zip;
        if (this.out) {
            fn = `${this.out.name || 'project'}.coq-pkg`;
            zip = (await this.out.toPackage(fn, ['.v', '.vo', '.cma'])).pkg.zip;
        }
        else if (this.project) {
            fn = `${this.project.name || 'project'}.zip`;
            zip = await this.project.toZip(undefined, ['.v', '.vo', '.cma']);
        }
        else return;

        var blob = await zip.generateAsync({type: 'blob'}),
            a = $('<a>').attr({'href': URL.createObjectURL(blob),
                               'download': fn});
        a[0].click();
    }

    _createDOM() {
        return $('<div>').attr('id', 'project-panel').html(`
            <div class="toolbar">
                <button @click="$emit('new')">new</button>
                <button @click="$emit('build')">build</button>
                <button @click="$emit('download')">download</button>
            </div>
            <file-list ref="file_list" :files="root"
                       @action="$emit('action', $event)"/>
        `)[0]; 
    }

    _update(files, status) {
        for (let filename of files) {
            var e = this.view.$refs.file_list.create(filename),
                fstatus = status[filename];
            e.tags = fstatus ? [ProjectPanel.BULLETS[fstatus]] : [];
        }
    }

    _progress(files) {
        for (let {filename, status} of files)
            Vue.set(this.view.status, filename, status);
    }

    _associateStore() {
        // Only one editor store can exist at any given time :/
        const volume = this.project.volume;
        CmCoqProvider.file_store = {
            async getItem(filename) { return volume.readFileSync(filename, 'utf-8'); },
            async setItem(filename, content) { volume.writeFileSync(filename, content); }
        };        
    }

    onAction(ev) {
        if (this.editor_provider 
              && ev.type === 'select' && ev.kind === 'file') {
            this.editor_provider.openLocal(`/${ev.path.join('/')}`);
            if (this.report)
                requestAnimationFrame(() => this.report._updateMarks());
        }
    }

    static attach(container, provider, name) {
        if (provider.snippets) provider = provider.snippets[0];

        var panel = new ProjectPanel().withEditor(provider);
        container.append(panel.$el);

        if (name == 'sample')
            panel.open(ProjectPanel.sample());
        return panel;
    }

    /**
     * This is here temporarily for quick testing.
     */
    static sample() {
        // sample project
        var vol = new InMemoryVolume();
        vol.fs.writeFileSync('/simple/_CoqProject', '-R . simple\n\nOne.v Two.v Three.v\n');
        vol.fs.writeFileSync('/simple/One.v', 'Check 1.\nFrom simple Require Import Two.');
        vol.fs.writeFileSync('/simple/Two.v', '\n\nDefinition two_of a := a + a.\n');
        vol.fs.writeFileSync('/simple/Three.v', 'From simple Require Import One Two.');
    
        var proj = new CoqProject('sample', vol).fromDirectory('/');
        return proj;
    }    

}


ProjectPanel.BULLETS = {
    compiling: {text: '◎', class: 'compiling'},
    compiled: {text: '✓', class: 'compiled'},
    error: {text: '✗', class: 'error'}
};


class LogicalVolume extends InMemoryVolume {

    async fromWebKitEntry(entry /* DirectoryEntry | FileEntry */) {
        await new Promise(resolve => {
            if (entry.isFile) {
                entry.file(async b => {
                    let content = new Uint8Array(await b.arrayBuffer());
                    this.writeFileSync(entry.fullPath, content);
                    resolve();
                });
            }
            else if (entry.isDirectory) {
                let readdir = entry.createReader();
                readdir.readEntries(async entries => {
                    for (let e of entries) await this.fromWebKitEntry(e);
                    resolve();
                });
            }
        });
        return this;
    }

}


class BuildReport {

    constructor(inproj) {
        this.inproj = inproj;
        this.errors = new Map();
        this.editor = undefined;
    }

    add(e) {
        switch (e[0]) {
        case 'CoqExn':
            var err = this.decorateError(e);
            coq.layout.log(err.msg, 'Error');   // oops
            if (err.loc) {
                this.errors.set(err.loc.filename,
                    (this.errors.get(err.loc.filename) || []).concat([err]));
                this._updateMarks();
            }
            break;
        }
    }

    clear() {
        this.errors = new Map();
        this._updateMarks();
    }

    decorateError(coqexn) {
        let [, loc, , msg] = coqexn, err = {};
        // Convert character positions to {line, ch}
        if (loc) {
            err.loc = {filename: loc.fname[1].replace(/^\/lib/, '')};
            try {
                var fn = err.loc.filename,
                    source = this.inproj.volume.fs.readFileSync(fn, 'utf-8');
                err.loc.start = BuildReport.posToLineCh(source, loc.bp);
                err.loc.end =   BuildReport.posToLineCh(source, loc.ep);
            }
            catch (e) { console.warn('cannot get code location for', loc, e); }
        }
        var at = err.loc &&
            `${err.loc.filename}:${err.loc.start ? err.loc.start.line + 1 : '?'}`
        err.msg = $('<p>').text(`at ${at || '<unknown>'}:`).addClass('error-location')
                  .add(coq.pprint.pp2DOM(msg));  // oops
        return err;
    }

    /**
     * Translates a character index to a {line, ch} location indicator.
     * @param {string} source_text document being referenced
     * @param {integer} pos character offset from beginning of string 
     *   (zero-based)
     * @return {object} a {line, ch} object with (zero-based) line and 
     *   character location
     */
    static posToLineCh(source_text, pos) {
        var offset = 0, line = 0, ch = pos;
        do {
            var eol = source_text.indexOf('\n', offset);
            if (eol === -1 || eol >= pos) break;
            line++; 
            ch -= (eol - offset + 1);
            offset = eol + 1;
        } while (true);

        return {line, ch};
    }

    _updateMarks() {
        if (this.editor) {
            var filename = this.editor.filename;

            for (let stm of this._active_marks || []) stm.mark.clear();
            this._active_marks = [];

            if (filename && this.errors.has(filename)) {
                for (let e of this.errors.get(filename)) {
                    if (e.loc && e.loc.start && e.loc.end) {
                        var stm = {start: e.loc.start, end: e.loc.end};
                        this._active_marks.push(stm);
                        this.editor.mark(stm, 'error');
                    }
                }
            }
        }
    }    
}



export { ProjectPanel, CoqProject }
