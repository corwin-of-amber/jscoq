// Build with
//  parcel watch ui-js/ide-project.js -d _build/jscoq+64bit/ui-js -o ide-project.browser.js --global ideProject

import Vue from 'vue/dist/vue';
import { BatchWorker, CompileTask } from './build/batch';
import { CoqProject, InMemoryVolume } from './build/project';



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
        this.view.$on('build', () => this.build()
            .catch(e => { if (e[0] != 'CoqExn') throw e; }));

        this.editor_provider = undefined;
    }

    get $el() { return this.view.$el; }

    open(project) {
        this.project = project;
        this.view.files = [...project.modulesByExt('.v')]
                          .map(mod => mod.physical);
        this.view.status = {};

        this.report = new BuildReport(this.project);

        if (this.editor_provider) this._associateStore();
    }

    withEditor(editor_provider) {
        this.editor_provider = editor_provider;
        if (this.project) this._associateStore();
        return this;
    }

    async build(coq) {
        this.view.status = {};

        if (this.editor_provider.dirty) this.editor_provider.saveLocal();

        coq = coq || new CoqWorker();
        await coq.when_created;

        var task = new CompileTask(new BatchWorker(coq.worker), this.project);
        task.on('progress', files => this._progress(files));
        task.on('report', e => this.report.add(e));
        return task.run();
    }

    _createDOM() {
        return $('<div>').attr('id', 'project-panel').html(`
            <div class="toolbar">
                <button @click="$emit('build')">build</button>
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
            // @todo update marks (from build)
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


class BuildReport {

    constructor(inproj) {
        this.inproj = inproj;
    }

    add(e) {
        switch (e[0]) {
        case 'CoqExn':
            var err = this.decorateError(e);
            coq.layout.log(err.msg, 'Error');   // oops
            break;
        }
    }

    decorateError(coqexn) {
        let [, loc, , msg] = coqexn, err = {};
        // Convert character positions to {line, ch}
        if (loc) {
            try {
                var fn = loc.fname[1].replace(/^\/lib/, ''),
                    source = this.inproj.volume.fs.readFileSync(fn, 'utf-8');
                err.loc = {start: BuildReport.posToLineCh(source, loc.bp),
                           end:   BuildReport.posToLineCh(source, loc.ep)};
            }
            catch (e) { console.warn('cannot get code location for', loc, e); }
        }
        var at = `${loc.fname[1]}:${err.loc ? err.loc.start.line + 1 : '?'}`;
        err.msg = $('<p>').text(`at ${at}:`)
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

}



export { ProjectPanel, CoqProject }
